import { Injectable, Logger } from '@nestjs/common';
import { LedgerEntryType } from '@prisma/client';
import {
  AdminPaymentSummaryLedgerRow,
  LedgerRepository,
} from '../../../ledger/ledger.repository';
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

  constructor(private readonly ledgerRepository: LedgerRepository) {}

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

    page.items = await Promise.all(
      pageGroups.map((group) => toSummaryModel(group, getPendingDebt)),
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

function findByType(
  rows: AdminPaymentSummaryLedgerRow[],
  type: LedgerEntryType,
): AdminPaymentSummaryLedgerRow | undefined {
  return rows.find((row) => row.type === type);
}

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
): AdminLedgerProfessionalModel {
  const model = new AdminLedgerProfessionalModel();
  model.id = professionalProfile.id;
  model.userId = professionalProfile.user.id;
  model.email = professionalProfile.user.email;
  model.firstName = professionalProfile.firstName;
  model.lastName = professionalProfile.lastName;
  model.displayName = professionalProfile.displayName;
  return model;
}

/**
 * The one place that decides, per event group, which `AdminEngagementPaymentEventType`
 * it is and how to compute `totalPaidByCustomer`/`platformCommission`/
 * `professionalNetAmount` — see each branch's own comment for the business
 * rule it mirrors (DEC-008 for cancellations, GOS-87 for cash).
 */
async function toSummaryModel(
  group: EventGroup,
  getPendingDebt: (professionalProfileId: string) => Promise<number>,
): Promise<AdminEngagementPaymentSummaryModel> {
  const engagement = group.engagement!; // non-null — see groupIntoEvents' own filter.
  const currency = group.rows[0].currency; // every row in one event shares the same currency.

  const model = new AdminEngagementPaymentSummaryModel();
  model.engagementId = group.engagementId;
  model.paymentMethod = engagement.paymentMethod;
  model.customer = toCustomerModel(engagement.customerProfile);
  model.professional = toProfessionalModel(engagement.professionalProfile);
  model.currency = currency;
  model.occurredAt = group.occurredAt;
  model.entries = group.rows.map(toAdminLedgerEntryModel);
  model.professionalTotalPendingCashDebt = null;

  const cashDebt = findByType(group.rows, LedgerEntryType.CASH_COMMISSION_DEBT);
  const cancellationFee = findByType(
    group.rows,
    LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
  );
  const refund = findByType(group.rows, LedgerEntryType.REFUND);
  const digitalCharge = findByType(group.rows, LedgerEntryType.CUSTOMER_CHARGE);

  if (cashDebt) {
    // GOS-87 — the Professional collected the FULL quoted price directly
    // from the Customer, in cash; GoService's own cut is exactly the
    // CASH_COMMISSION_DEBT amount, never independently re-derived from it
    // (rounding could disagree) — the source of truth for the full price is
    // the Quote itself.
    const quotedPrice =
      engagement.quote.negotiatedPrice ?? engagement.quote.price;
    model.eventType = AdminEngagementPaymentEventType.CASH_PAYMENT;
    model.totalPaidByCustomer = quotedPrice;
    model.platformCommission = cashDebt.amount;
    model.professionalNetAmount = quotedPrice - cashDebt.amount;
    model.professionalTotalPendingCashDebt = await getPendingDebt(
      engagement.professionalProfile.id,
    );
    return model;
  }

  if (cancellationFee) {
    // DEC-008 point 5 — the cancellation FEE (not the full job price, which
    // was never fully paid since the work was never completed) is split
    // between GoService and the Professional exactly like a normal
    // completed-job commission would be.
    const platformCommission = findByType(
      group.rows,
      LedgerEntryType.PLATFORM_COMMISSION,
    );
    const professionalNet = findByType(
      group.rows,
      LedgerEntryType.PROFESSIONAL_NET_CREDIT,
    );
    model.eventType = AdminEngagementPaymentEventType.CUSTOMER_CANCELLATION;
    model.totalPaidByCustomer = Math.abs(cancellationFee.amount);
    model.platformCommission = platformCommission?.amount ?? 0;
    model.professionalNetAmount = professionalNet?.amount ?? 0;
    return model;
  }

  if (refund) {
    // DEC-008 — "unaffected by this DEC ... full refund to the Customer, no
    // charge": net paid by the Customer for this job is 0, nothing is split.
    model.eventType = AdminEngagementPaymentEventType.PROFESSIONAL_CANCELLATION;
    model.totalPaidByCustomer = 0;
    model.platformCommission = 0;
    model.professionalNetAmount = 0;
    return model;
  }

  // RESERVED branch — no writer exists for CUSTOMER_CHARGE yet (GOS-79/80),
  // included so this service needs no shape change once it does. `amount`
  // is treated as the full price paid; commission/net are left at 0 rather
  // than guessed, since the real split rule for a digital payment isn't
  // decided/built yet.
  model.eventType = AdminEngagementPaymentEventType.DIGITAL_PAYMENT;
  model.totalPaidByCustomer = digitalCharge?.amount ?? 0;
  model.platformCommission = 0;
  model.professionalNetAmount = 0;
  return model;
}
