import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { PaymentMethod } from '../../ledger/models/payment-method.enum';
import { EngagementFinancialSummaryCustomerModel } from './engagement-financial-summary-customer.model';
import { EngagementFinancialSummaryProfessionalModel } from './engagement-financial-summary-professional.model';
import { EngagementFinancialSummaryViewerRole } from './engagement-financial-summary-viewer-role.enum';
import { EngagementPaymentEventType } from './engagement-payment-event-type.enum';

/**
 * GOS-130 follow-up — `Query.engagementFinancialSummary(engagementId)`'s
 * response type. This is the ORIGINAL intent of GOS-110
 * (`engagementFinancialSnapshot`), which GOS-133 (backend of GOS-110)
 * deliberately deferred in favor of the simpler flat `myPaymentReceipts`;
 * this completes that deferred, per-Engagement-grouped piece.
 *
 * **Role-restricted visibility (deliberate, resolved via AskUserQuestion,
 * the most conservative of three options considered)**: the response
 * exposes ONLY the calling party's own breakdown. `customer` is populated
 * (non-null) and `professional` is `null` when the caller is the
 * Engagement's Customer; vice versa for the Professional. Neither party
 * EVER sees the other's figures through this query — no partial/symmetric
 * fields. `viewerRole` makes which side is populated explicit, rather than
 * leaving the client to infer it from nullness.
 *
 * **"Most recent event only", not a cumulative aggregate** across the
 * Engagement's whole life — documented as a revisitable assumption, valid
 * because a terminal financial event (cash-confirm, customer cancellation,
 * or professional cancellation/refund) can currently only happen once per
 * Engagement. See `selectMostRecentLedgerEventRows`'s own header comment
 * (`src/ledger/services/classify-engagement-payment-event.util.ts`).
 *
 * A COMPUTED VIEW, not a persisted entity — derived from `LedgerEntry` +
 * `Quote` + `Engagement`, same status as `AdminEngagementPaymentSummary`.
 * See `domain-model.md` for the full write-up.
 */
@ObjectType('EngagementFinancialSummary')
export class EngagementFinancialSummaryModel {
  @Field(() => ID)
  engagementId!: string;

  @Field(() => String)
  currency!: string;

  // `null` before any financial event has happened yet (e.g. a freshly
  // ACCEPTED Engagement with no payment method confirmed and no
  // cancellation).
  @Field(() => EngagementPaymentEventType, { nullable: true })
  eventType!: EngagementPaymentEventType | null;

  @Field(() => PaymentMethod, { nullable: true })
  paymentMethod!: PaymentMethod | null;

  // `null` pre-event, alongside `eventType`.
  @Field(() => GraphQLISODateTime, { nullable: true })
  occurredAt!: Date | null;

  @Field(() => EngagementFinancialSummaryViewerRole)
  viewerRole!: EngagementFinancialSummaryViewerRole;

  // Non-null only when `viewerRole === CUSTOMER`.
  @Field(() => EngagementFinancialSummaryCustomerModel, { nullable: true })
  customer!: EngagementFinancialSummaryCustomerModel | null;

  // Non-null only when `viewerRole === PROFESSIONAL`.
  @Field(() => EngagementFinancialSummaryProfessionalModel, {
    nullable: true,
  })
  professional!: EngagementFinancialSummaryProfessionalModel | null;
}
