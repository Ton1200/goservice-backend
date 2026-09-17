import { Injectable } from '@nestjs/common';
import { LedgerEntry, LedgerEntryType } from '@prisma/client';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { LedgerRepository } from '../../ledger/ledger.repository';
import {
  ClassifiedLedgerEvent,
  classifyLedgerEventRows,
  EngagementPaymentEventKind,
  findByType,
  selectMostRecentLedgerEventRows,
} from '../../ledger/services/classify-engagement-payment-event.util';
import {
  EngagementFinancialSummaryAccessService,
  EngagementFinancialSummaryPartyRole,
} from '../engagement-financial-summary-access.service';
import { EngagementFinancialSummaryCustomerModel } from '../models/engagement-financial-summary-customer.model';
import { EngagementFinancialSummaryProfessionalModel } from '../models/engagement-financial-summary-professional.model';
import { EngagementFinancialSummaryModel } from '../models/engagement-financial-summary.model';
import { EngagementFinancialSummaryViewerRole } from '../models/engagement-financial-summary-viewer-role.enum';
import { EngagementPaymentEventType } from '../models/engagement-payment-event-type.enum';

const EVENT_TYPE_BY_KIND: Record<
  EngagementPaymentEventKind,
  EngagementPaymentEventType
> = {
  CASH_PAYMENT: EngagementPaymentEventType.CASH_PAYMENT,
  CUSTOMER_CANCELLATION: EngagementPaymentEventType.CUSTOMER_CANCELLATION,
  PROFESSIONAL_CANCELLATION:
    EngagementPaymentEventType.PROFESSIONAL_CANCELLATION,
  DIGITAL_PAYMENT: EngagementPaymentEventType.DIGITAL_PAYMENT,
};

const VIEWER_ROLE_BY_PARTY_ROLE: Record<
  EngagementFinancialSummaryPartyRole,
  EngagementFinancialSummaryViewerRole
> = {
  CUSTOMER: EngagementFinancialSummaryViewerRole.CUSTOMER,
  PROFESSIONAL: EngagementFinancialSummaryViewerRole.PROFESSIONAL,
};

// Events whose Professional-side `netAmount` really did (or will) land in
// the Professional's pocket net of GoService's cut — used for the
// CORRECTED `walletImpact` (decision #2). `PROFESSIONAL_CANCELLATION` is
// deliberately excluded (they earn nothing — `netAmount` is already 0
// there anyway) and so is `DIGITAL_PAYMENT` (no writer yet).
const WALLET_IMPACT_EVENT_KINDS = new Set<EngagementPaymentEventKind>([
  'CASH_PAYMENT',
  'CUSTOMER_CANCELLATION',
]);

function toPreEventCustomerModel(
  quotedPrice: number,
): EngagementFinancialSummaryCustomerModel {
  const model = new EngagementFinancialSummaryCustomerModel();
  model.workAmount = quotedPrice;
  model.platformFee = 0;
  model.cancellationFee = 0;
  model.refundAmount = 0;
  model.totalCharged = 0;
  return model;
}

function toPreEventProfessionalModel(
  quotedPrice: number,
): EngagementFinancialSummaryProfessionalModel {
  const model = new EngagementFinancialSummaryProfessionalModel();
  model.grossAmount = quotedPrice;
  model.platformCommission = 0;
  model.netAmount = 0;
  model.cashCommissionDebt = 0;
  model.walletImpact = 0;
  return model;
}

/**
 * `platformFee`/`cancellationFee` are only meaningful for a
 * CUSTOMER_CANCELLATION event — a cash payment is never charged to the
 * Customer THROUGH the platform (they paid the Professional directly, in
 * cash), and a refund carries no fee at all (DEC-008). `refundAmount` is
 * pulled straight from the raw `REFUND` row (`classifyLedgerEventRows`
 * itself always reports `totalPaidByCustomer: 0` for that branch, by
 * design — see that function's own comment) rather than from `classified`.
 * `totalCharged` is exactly `classified.totalPaidByCustomer` for every
 * event kind (it already resolves to the right figure — the full price for
 * CASH_PAYMENT, the fee for CUSTOMER_CANCELLATION, 0 for
 * PROFESSIONAL_CANCELLATION) with no extra branching needed.
 */
function toEventCustomerModel(
  classified: ClassifiedLedgerEvent,
  quotedPrice: number,
  eventRows: LedgerEntry[],
): EngagementFinancialSummaryCustomerModel {
  const model = new EngagementFinancialSummaryCustomerModel();
  const isCancellation = classified.eventType === 'CUSTOMER_CANCELLATION';
  model.workAmount = quotedPrice;
  model.platformFee = isCancellation ? classified.platformCommission : 0;
  model.cancellationFee = isCancellation ? classified.totalPaidByCustomer : 0;
  model.refundAmount =
    classified.eventType === 'PROFESSIONAL_CANCELLATION'
      ? (findByType(eventRows, LedgerEntryType.REFUND)?.amount ?? 0)
      : 0;
  model.totalCharged = classified.totalPaidByCustomer;
  return model;
}

/**
 * `grossAmount`/`platformCommission`/`netAmount`/`cashCommissionDebt` map
 * directly off `classified` for every event kind with no extra branching —
 * `classifyLedgerEventRows` already zeroes what doesn't apply per kind.
 * `walletImpact` is the one CORRECTED figure — see
 * `WALLET_IMPACT_EVENT_KINDS`'s own comment and this module's other header
 * comments for the full explanation (flagged back to `goservice-mobile`,
 * GOS-130/Tomas, when reporting this change done).
 */
function toEventProfessionalModel(
  classified: ClassifiedLedgerEvent,
): EngagementFinancialSummaryProfessionalModel {
  const model = new EngagementFinancialSummaryProfessionalModel();
  model.grossAmount = classified.totalPaidByCustomer;
  model.platformCommission = classified.platformCommission;
  model.netAmount = classified.professionalNetAmount;
  model.cashCommissionDebt = classified.cashCommissionDebtAmount;
  model.walletImpact = WALLET_IMPACT_EVENT_KINDS.has(classified.eventType)
    ? classified.professionalNetAmount
    : 0;
  return model;
}

/**
 * Orchestrates `Query.engagementFinancialSummary(engagementId)` — the
 * ORIGINAL intent of GOS-110 (`engagementFinancialSnapshot`), completing
 * what GOS-133 (backend of GOS-110) deliberately deferred in favor of the
 * simpler flat `myPaymentReceipts`. See `EngagementFinancialSummaryModel`'s
 * own header comment for the role-restricted-visibility and
 * most-recent-event-only decisions this service implements.
 */
@Injectable()
export class GetEngagementFinancialSummaryService {
  constructor(
    private readonly accessService: EngagementFinancialSummaryAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async getEngagementFinancialSummary(
    userId: string,
    engagementId: string,
  ): Promise<EngagementFinancialSummaryModel> {
    const party = await this.accessService.resolveParty(userId, engagementId);

    // `resolveParty` above already proved this Engagement exists and the
    // caller is a party to it — this narrow read can never legitimately
    // come back `null` here (an `Engagement` row is never deleted once
    // created).
    const engagementContext =
      await this.engagementsRepository.findByIdWithFinancialSummaryContext(
        engagementId,
      );
    const context = engagementContext!;
    const quotedPrice = context.quote.negotiatedPrice ?? context.quote.price;

    const rows =
      await this.ledgerRepository.findManyByEngagementId(engagementId);
    const eventRows = selectMostRecentLedgerEventRows(rows);

    const model = new EngagementFinancialSummaryModel();
    model.engagementId = engagementId;
    model.viewerRole = VIEWER_ROLE_BY_PARTY_ROLE[party.role];
    model.customer = null;
    model.professional = null;
    model.paymentMethod = context.paymentMethod;

    if (eventRows.length === 0) {
      // Pre-event — no financial event has happened for this Engagement
      // yet.
      model.eventType = null;
      model.occurredAt = null;
      model.currency = CURRENCY_BY_COUNTRY[context.customerProfile.country];

      if (party.role === 'CUSTOMER') {
        model.customer = toPreEventCustomerModel(quotedPrice);
      } else {
        model.professional = toPreEventProfessionalModel(quotedPrice);
      }
      return model;
    }

    const classified = classifyLedgerEventRows(eventRows, quotedPrice);
    model.eventType = EVENT_TYPE_BY_KIND[classified.eventType];
    model.occurredAt = eventRows[0].createdAt;
    model.currency = eventRows[0].currency;

    if (party.role === 'CUSTOMER') {
      model.customer = toEventCustomerModel(classified, quotedPrice, eventRows);
    } else {
      model.professional = toEventProfessionalModel(classified);
    }

    return model;
  }
}
