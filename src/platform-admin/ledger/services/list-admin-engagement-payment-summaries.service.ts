import { Injectable, Logger } from '@nestjs/common';
import {
  AdminPaymentSummaryLedgerRow,
  LedgerRepository,
} from '../../../ledger/ledger.repository';
import {
  classifyLedgerEventRows,
  EngagementPaymentEventKind,
} from '../../../ledger/services/classify-engagement-payment-event.util';
import { PaymentAttemptRepository } from '../../../payments/payment-attempt.repository';
import { toAdminPaymentAttemptModel } from '../../payment-attempts/models/to-admin-payment-attempt-model.util';
import { AdminEngagementPaymentEventType } from '../models/admin-engagement-payment-event-type.enum';
import { AdminEngagementPaymentSummaryModel } from '../models/admin-engagement-payment-summary.model';
import { AdminEngagementPaymentSummariesPageModel } from '../models/admin-engagement-payment-summaries-page.model';
import { AdminLedgerCustomerModel } from '../models/admin-ledger-customer.model';
import { AdminLedgerProfessionalModel } from '../models/admin-ledger-professional.model';
import { toAdminLedgerEntryModel } from '../models/to-admin-ledger-entry-model.util';

const DEFAULT_LIMIT = 50;
// Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
// `ListAdminLedgerEntriesService`/`ListAdminReviewsService`.
const MAX_LIMIT = 200;

type EventGroup = {
  engagementId: string;
  occurredAt: Date;
  engagement: AdminPaymentSummaryLedgerRow['engagement'];
  rows: AdminPaymentSummaryLedgerRow[];
};

/**
 * Orchestrates `Query.adminEngagementPaymentSummaries` (2026-09-14
 * follow-up, human-requested) — turns the flat `LedgerEntry` stream into
 * ONE ROW PER FINANCIAL EVENT, with real Customer/Professional names and
 * pre-computed totals, so an admin never has to mentally group/add up raw
 * ledger rows by hand. See `LedgerRepository.findManyForAdminPaymentSummaries`'s
 * own comment for the grouping key and the documented phase-1 pagination
 * scope boundary this service's own `limit`/`offset` handling inherits.
 */
@Injectable()
export class ListAdminEngagementPaymentSummariesService {
  private readonly logger = new Logger(
    ListAdminEngagementPaymentSummariesService.name,
  );

  constructor(
    private readonly ledgerRepository: LedgerRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
  ) {}

  async listEngagementPaymentSummaries(
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminEngagementPaymentSummariesPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const rows = await this.ledgerRepository.findManyForAdminPaymentSummaries();
    const groups = groupIntoEvents(rows, this.logger);

    const page = new AdminEngagementPaymentSummariesPageModel();
    page.totalCount = groups.length;
    page.limit = limit;
    page.offset = offset;

    const pageGroups = groups.slice(offset, offset + limit);
    // Cache within this one request — several summaries on the SAME page
    // may belong to the SAME Professional (e.g. two different cash jobs),
    // and each one's `professionalTotalPendingCashDebt` is the exact same
    // number — no reason to re-query it per row.
    const pendingDebtCache = new Map<string, Promise<number>>();
    const getPendingDebt = (professionalProfileId: string): Promise<number> => {
      let cached = pendingDebtCache.get(professionalProfileId);
      if (!cached) {
        cached = this.ledgerRepository.sumCashCommissionDebtForProfessional(
          professionalProfileId,
        );
        pendingDebtCache.set(professionalProfileId, cached);
      }
      return cached;
    };
    // Same per-request cache, for the Professional's own current balance —
    // shown on EVERY row (not only CASH_PAYMENT), so several rows for the
    // same Professional share one query.
    const balanceCache = new Map<string, Promise<number>>();
    const getBalance = (professionalProfileId: string): Promise<number> => {
      let cached = balanceCache.get(professionalProfileId);
      if (!cached) {
        cached = this.ledgerRepository.sumProfessionalBalance(
          professionalProfileId,
        );
        balanceCache.set(professionalProfileId, cached);
      }
      return cached;
    };

    page.items = await Promise.all(
      pageGroups.map((group) =>
        toSummaryModel(
          group,
          getPendingDebt,
          getBalance,
          this.paymentAttemptRepository,
        ),
      ),
    );
    return page;
  }
}

/**
 * Groups the flat, most-recent-first `rows` (already capped/ordered by the
 * repository) by `(engagementId, createdAt)` — every `LedgerEntry` written
 * inside the SAME `prisma.$transaction` shares the exact same `createdAt`
 * (Postgres's `now()` returns the transaction start time for every
 * statement in one transaction), so this pair reliably identifies "these
 * rows are one financial event", even for an Engagement that has MORE than
 * one event over its life (e.g. a cash payment confirmed, then later — a
 * genuine edge case — cancelled anyway).
 */
function groupIntoEvents(
  rows: AdminPaymentSummaryLedgerRow[],
  logger: Logger,
): EventGroup[] {
  const groupsByKey = new Map<string, EventGroup>();

  for (const row of rows) {
    if (!row.engagement) {
      // Defensive only — the repository's own `WHERE engagementId IS NOT
      // NULL` should make this impossible; logged, never thrown, since one
      // anomalous row must never break the whole admin grid.
      logger.warn({
        event: 'admin_payment_summary_orphaned_ledger_entry',
        ledgerEntryId: row.id,
      });
      continue;
    }

    const key = `${row.engagementId}|${row.createdAt.getTime()}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        engagementId: row.engagementId!,
        occurredAt: row.createdAt,
        engagement: row.engagement,
        rows: [],
      };
      groupsByKey.set(key, group);
    }
    group.rows.push(row);
  }

  // `rows` is already most-recent-first; `Map` preserves insertion order,
  // so the resulting groups are already sorted the same way — no re-sort
  // needed.
  return [...groupsByKey.values()];
}

const ADMIN_EVENT_TYPE_BY_KIND: Record<
  EngagementPaymentEventKind,
  AdminEngagementPaymentEventType
> = {
  CASH_PAYMENT: AdminEngagementPaymentEventType.CASH_PAYMENT,
  CUSTOMER_CANCELLATION: AdminEngagementPaymentEventType.CUSTOMER_CANCELLATION,
  PROFESSIONAL_CANCELLATION:
    AdminEngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
  DIGITAL_PAYMENT: AdminEngagementPaymentEventType.DIGITAL_PAYMENT,
};

function toCustomerModel(
  customerProfile: NonNullable<
    AdminPaymentSummaryLedgerRow['engagement']
  >['customerProfile'],
): AdminLedgerCustomerModel {
  const model = new AdminLedgerCustomerModel();
  model.id = customerProfile.id;
  model.userId = customerProfile.user.id;
  model.email = customerProfile.user.email;
  model.firstName = customerProfile.firstName;
  model.lastName = customerProfile.lastName;
  return model;
}

function toProfessionalModel(
  professionalProfile: NonNullable<
    AdminPaymentSummaryLedgerRow['engagement']
  >['professionalProfile'],
  balance: number,
): AdminLedgerProfessionalModel {
  const model = new AdminLedgerProfessionalModel();
  model.id = professionalProfile.id;
  model.userId = professionalProfile.user.id;
  model.email = professionalProfile.user.email;
  model.firstName = professionalProfile.firstName;
  model.lastName = professionalProfile.lastName;
  model.displayName = professionalProfile.displayName;
  model.balance = balance;
  return model;
}

/**
 * Decides, per event group, which `AdminEngagementPaymentEventType` it is
 * and how to compute `totalPaidByCustomer`/`platformCommission`/
 * `professionalNetAmount` — delegated to the shared, schema-agnostic
 * `classifyLedgerEventRows` (`src/ledger/services/classify-engagement-payment-event.util.ts`,
 * GOS-130 follow-up), so this admin view and the consumer-facing
 * `engagementFinancialSummary` (`src/engagement-financial-summary/`) can
 * never drift on the underlying business rule (DEC-008 for cancellations,
 * GOS-87 for cash) even though each maps the result to its OWN,
 * independent GraphQL enum.
 */
async function toSummaryModel(
  group: EventGroup,
  getPendingDebt: (professionalProfileId: string) => Promise<number>,
  getBalance: (professionalProfileId: string) => Promise<number>,
  paymentAttemptRepository: PaymentAttemptRepository,
): Promise<AdminEngagementPaymentSummaryModel> {
  const engagement = group.engagement!; // non-null — see groupIntoEvents' own filter.
  const currency = group.rows[0].currency; // every row in one event shares the same currency.
  const quotedPrice =
    engagement.quote.negotiatedPrice ?? engagement.quote.price;

  const model = new AdminEngagementPaymentSummaryModel();
  model.engagementId = group.engagementId;
  model.paymentMethod = engagement.paymentMethod;
  model.customer = toCustomerModel(engagement.customerProfile);
  model.professional = toProfessionalModel(
    engagement.professionalProfile,
    await getBalance(engagement.professionalProfile.id),
  );
  model.currency = currency;
  model.occurredAt = group.occurredAt;
  model.entries = group.rows.map(toAdminLedgerEntryModel);
  model.professionalTotalPendingCashDebt = null;

  const classified = classifyLedgerEventRows(group.rows, quotedPrice);
  model.eventType = ADMIN_EVENT_TYPE_BY_KIND[classified.eventType];
  model.totalPaidByCustomer = classified.totalPaidByCustomer;
  model.platformCommission = classified.platformCommission;
  model.professionalNetAmount = classified.professionalNetAmount;

  if (classified.eventType === 'CASH_PAYMENT') {
    model.professionalTotalPendingCashDebt = await getPendingDebt(
      engagement.professionalProfile.id,
    );
  }

  const approvedAttempt =
    await paymentAttemptRepository.findApprovedByEngagementId(
      group.engagementId,
    );
  model.paymentAttempt = approvedAttempt
    ? toAdminPaymentAttemptModel(approvedAttempt)
    : null;

  return model;
}
