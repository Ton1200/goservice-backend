import { Field, ID, ObjectType } from '@nestjs/graphql';
import { CashPaymentViewerRole } from './cash-payment-viewer-role.enum';

/**
 * `myCashPaymentConfirmation`'s return type — the consumer-safe read model
 * of an Engagement's cash-payment double confirmation. Deliberately NOT a
 * mirror of the `CashPaymentConfirmation` row (that is `confirmCashPayment`'s
 * own return type): no timestamps, no `commissionDebtRecorded`, no ledger
 * data — only the facts a client needs to render the flow. All three
 * booleans are derived from the persisted row on every read; nothing here is
 * a second source of truth. Before either party has confirmed (no row yet),
 * all three are `false`.
 */
@ObjectType('CashPaymentConfirmationState')
export class CashPaymentConfirmationStateModel {
  @Field(() => ID)
  engagementId!: string;

  @Field(() => CashPaymentViewerRole)
  viewerRole!: CashPaymentViewerRole;

  @Field(() => Boolean)
  customerConfirmed!: boolean;

  @Field(() => Boolean)
  professionalConfirmed!: boolean;

  @Field(() => Boolean)
  bothConfirmed!: boolean;
}
