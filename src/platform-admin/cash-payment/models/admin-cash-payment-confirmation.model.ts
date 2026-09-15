import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * Admin-facing GraphQL type for `adminCashPaymentConfirmations`
 * (`/admin/graphql` only), gated by `Permission.CASH_PAYMENTS_READ`. A
 * straight 1:1 mirror of the underlying `CashPaymentConfirmation` row —
 * nothing is redacted for this audience, same posture as
 * `AdminLedgerEntryModel`. Unlike `adminLedgerEntries`, this surface
 * deliberately shows rows where only ONE of
 * `customerConfirmedAt`/`professionalConfirmedAt` is set — a
 * `CASH_COMMISSION_DEBT` `LedgerEntry` only ever exists once BOTH are.
 */
@ObjectType('AdminCashPaymentConfirmation')
export class AdminCashPaymentConfirmationModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  customerConfirmedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  professionalConfirmedAt!: Date | null;

  @Field(() => Boolean)
  commissionDebtRecorded!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
