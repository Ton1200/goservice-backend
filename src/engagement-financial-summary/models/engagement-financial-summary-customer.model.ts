import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * GOS-130 follow-up — the Customer-side breakdown of an
 * `EngagementFinancialSummary`. Only ever populated when
 * `EngagementFinancialSummary.viewerRole === CUSTOMER` — see that model's
 * own header comment for the role-restricted-visibility decision.
 */
@ObjectType('EngagementFinancialSummaryCustomer')
export class EngagementFinancialSummaryCustomerModel {
  // The full agreed job value (`Quote.negotiatedPrice ?? Quote.price`) —
  // populated even pre-event, so the Customer always sees what the job is
  // worth, regardless of whether any money has moved yet.
  @Field(() => Int)
  workAmount!: number;

  // GoService's own cut of `cancellationFee`, for a CUSTOMER_CANCELLATION
  // event only — 0 otherwise (a cash payment is never charged to the
  // Customer through the platform; a refund carries no fee).
  @Field(() => Int)
  platformFee!: number;

  // The cancellation fee actually charged to the Customer — only nonzero
  // for a CUSTOMER_CANCELLATION event (DEC-008 point 5: cancelling while
  // still ACCEPTED carries no charge).
  @Field(() => Int)
  cancellationFee!: number;

  // What was actually refunded to the Customer — only nonzero for a
  // PROFESSIONAL_CANCELLATION event (DEC-008: full refund, no charge).
  @Field(() => Int)
  refundAmount!: number;

  // What the Customer actually paid for this event: the full price in cash
  // (CASH_PAYMENT), the cancellation fee (CUSTOMER_CANCELLATION), or 0
  // (PROFESSIONAL_CANCELLATION / pre-event).
  @Field(() => Int)
  totalCharged!: number;
}
