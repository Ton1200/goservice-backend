import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * `confirmCashPayment`'s return type — a straight mirror of the
 * `CashPaymentConfirmation` row. Exposes both confirmation timestamps
 * (nullable — a caller sees the OTHER party's own confirmation state too,
 * not just their own write) and whether the commission debt was already
 * recorded, so a client can tell "both parties confirmed" apart from
 * "cash-payment confirmed, but the commission debt hasn't landed yet"
 * without a second round trip.
 */
@ObjectType('CashPaymentConfirmation')
export class CashPaymentConfirmationModel {
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
