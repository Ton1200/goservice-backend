import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * GOS-130 follow-up — the Professional-side breakdown of an
 * `EngagementFinancialSummary`. Only ever populated when
 * `EngagementFinancialSummary.viewerRole === PROFESSIONAL` — see that
 * model's own header comment for the role-restricted-visibility decision.
 */
@ObjectType('EngagementFinancialSummaryProfessional')
export class EngagementFinancialSummaryProfessionalModel {
  // The full amount the Professional's side of this event was computed
  // from: the full agreed price (`Quote.negotiatedPrice ?? Quote.price`)
  // pre-event and for CASH_PAYMENT, the cancellation fee for
  // CUSTOMER_CANCELLATION, or 0 for PROFESSIONAL_CANCELLATION.
  @Field(() => Int)
  grossAmount!: number;

  @Field(() => Int)
  platformCommission!: number;

  // What the Professional actually keeps: `grossAmount - platformCommission`
  // for CASH_PAYMENT, the real PROFESSIONAL_NET_CREDIT amount for a
  // CUSTOMER_CANCELLATION, or 0 for a PROFESSIONAL_CANCELLATION (they
  // cancelled — they earn nothing).
  @Field(() => Int)
  netAmount!: number;

  // Only nonzero for a CASH_PAYMENT event — the CASH_COMMISSION_DEBT amount
  // this specific job added to the Professional's running debt (see
  // `myPendingCashCommissionDebt` for their TOTAL outstanding balance
  // across every cash job, a separate, broader figure this field does not
  // replace).
  @Field(() => Int)
  cashCommissionDebt!: number;

  // **Corrected from the frontend's own literal `netAmount - cashCommissionDebt`
  // formula** — that double-subtracts the commission, since `netAmount` for
  // a cash job is already `grossAmount - cashCommissionDebt`. Equal to
  // `netAmount` for CASH_PAYMENT/CUSTOMER_CANCELLATION, `0` otherwise
  // (PROFESSIONAL_CANCELLATION / DIGITAL_PAYMENT / pre-event) — see this
  // module's own resolver/service header comments for the full
  // explanation, flagged back to `goservice-mobile` (GOS-130/Tomas) when
  // reporting this change done.
  @Field(() => Int)
  walletImpact!: number;
}
