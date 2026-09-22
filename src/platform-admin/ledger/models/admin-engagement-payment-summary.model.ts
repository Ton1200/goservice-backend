import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { PaymentMethod } from '../../../ledger/models/payment-method.enum';
import { AdminPaymentAttemptModel } from '../../payment-attempts/models/admin-payment-attempt.model';
import { AdminLedgerEntryModel } from './admin-ledger-entry.model';
import { AdminEngagementPaymentEventType } from './admin-engagement-payment-event-type.enum';
import { AdminLedgerCustomerModel } from './admin-ledger-customer.model';
import { AdminLedgerProfessionalModel } from './admin-ledger-professional.model';

/**
 * 2026-09-14 follow-up (human-requested) — ONE ROW PER JOB, not per
 * `LedgerEntry` row: groups every `LedgerEntry` written together (same
 * `engagementId` + the SAME transaction's `createdAt` — see
 * `LedgerRepository.findManyForAdminPaymentSummaries`'s own comment) into a
 * single, human-readable summary with real names instead of raw ids, and
 * pre-computed totals instead of making an admin add rows up by hand.
 *
 * `entries` carries the raw, unmodified `LedgerEntry` rows this summary was
 * computed from — the admin panel's detail popup renders these directly,
 * no second query needed.
 */
@ObjectType('AdminEngagementPaymentSummary')
export class AdminEngagementPaymentSummaryModel {
  @Field(() => ID)
  engagementId!: string;

  @Field(() => AdminEngagementPaymentEventType)
  eventType!: AdminEngagementPaymentEventType;

  // `null` for an Engagement that never went through any payment-method
  // capability at all — should not normally happen for a row that HAS
  // LedgerEntry rows, but the underlying `Engagement.paymentMethod` column
  // is nullable, so this field mirrors that nullability rather than
  // silently coercing it.
  @Field(() => PaymentMethod, { nullable: true })
  paymentMethod!: PaymentMethod | null;

  @Field(() => AdminLedgerCustomerModel)
  customer!: AdminLedgerCustomerModel;

  @Field(() => AdminLedgerProfessionalModel)
  professional!: AdminLedgerProfessionalModel;

  // The total amount that actually left the Customer's pocket for this
  // event — the FULL agreed price for a completed CASH_PAYMENT (sourced
  // from the Quote, never back-computed from a rounded commission amount),
  // the cancellation FEE (not the full job price) for a CUSTOMER_CANCELLATION,
  // and 0 for a PROFESSIONAL_CANCELLATION (fully refunded, nothing net paid).
  @Field(() => Int)
  totalPaidByCustomer!: number;

  // GoService's own cut of `totalPaidByCustomer` — the CASH_COMMISSION_DEBT
  // amount, the PLATFORM_COMMISSION amount, or 0 for a refund.
  @Field(() => Int)
  platformCommission!: number;

  // What the Professional actually keeps — `totalPaidByCustomer -
  // platformCommission` for a cash job (derived, since no
  // PROFESSIONAL_NET_CREDIT row exists for cash), the real
  // PROFESSIONAL_NET_CREDIT amount for a customer cancellation, or 0 for a
  // professional cancellation (they cancelled — they earn nothing).
  @Field(() => Int)
  professionalNetAmount!: number;

  @Field(() => String)
  currency!: string;

  // Only populated for `eventType: CASH_PAYMENT` — the Professional's
  // TOTAL outstanding `CASH_COMMISSION_DEBT` balance across every cash job
  // they've ever done (same figure `myPendingCashCommissionDebt` computes
  // for the Professional themselves), so an admin immediately sees "this
  // job's commission is now PART OF that running total the Professional
  // still owes GoService" — not money GoService already collected.
  @Field(() => Int, { nullable: true })
  professionalTotalPendingCashDebt!: number | null;

  @Field(() => GraphQLISODateTime)
  occurredAt!: Date;

  @Field(() => [AdminLedgerEntryModel])
  entries!: AdminLedgerEntryModel[];

  // The ONE PaymentAttempt that was ever approved for this Engagement, if
  // any (2026-09-18) — how the job was ACTUALLY paid: type (credit card,
  // account money, cash…), card brand/last 4, provider fee/tax/net, or —
  // for cash — the two confirmation timestamps. `null` for a job never paid
  // (e.g. cancelled before any payment). See `PaymentAttemptRepository.
  // findApprovedByEngagementId`'s own comment for why this lookup is
  // reliable, not just "usually right".
  @Field(() => AdminPaymentAttemptModel, { nullable: true })
  paymentAttempt!: AdminPaymentAttemptModel | null;
}
