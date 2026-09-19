import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { PaymentAttemptType } from '../../../payments/models/payment-attempt-type.enum';
import { PaymentAttemptStatus } from '../../../payments/models/payment-attempt-status.enum';
import { PaymentMethod } from '../../../ledger/models/payment-method.enum';

/**
 * Admin-facing GraphQL type for `adminPaymentAttempts` (`/admin/graphql`
 * only), gated by `Permission.CASH_PAYMENTS_READ` (kept as the existing
 * permission name — see that resolver's own comment for why it was not
 * renamed). A straight 1:1 mirror of the underlying `PaymentAttempt` row —
 * nothing is redacted for this audience, same posture as
 * `AdminLedgerEntryModel`: unlike the Customer-facing `PaymentAttempt` type,
 * this one DOES expose `providerPaymentId`/fee/tax/net — an admin auditing a
 * payment needs exactly the figures that decide who absorbs a provider's
 * cost (DEC-009, still open).
 *
 * Covers EVERY method (cash and every digital one) — the surface this admin
 * view replaces (`adminCashPaymentConfirmations`) only ever showed cash.
 */
@ObjectType('AdminPaymentAttempt')
export class AdminPaymentAttemptModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => PaymentMethod)
  method!: PaymentMethod;

  @Field(() => PaymentAttemptType, { nullable: true })
  type!: PaymentAttemptType | null;

  @Field(() => PaymentAttemptStatus)
  status!: PaymentAttemptStatus;

  @Field(() => Int)
  amount!: number;

  @Field(() => String)
  currency!: string;

  @Field(() => Int)
  installments!: number;

  @Field(() => String, { nullable: true })
  rejectionReason!: string | null;

  @Field(() => String, { nullable: true })
  providerPaymentId!: string | null;

  @Field(() => String, { nullable: true })
  cardBrand!: string | null;

  @Field(() => String, { nullable: true })
  cardLastFour!: string | null;

  @Field(() => Int, { nullable: true })
  providerFeeAmount!: number | null;

  @Field(() => Int, { nullable: true })
  providerTaxAmount!: number | null;

  @Field(() => Int, { nullable: true })
  netReceivedAmount!: number | null;

  // Cash only — null for every digital attempt.
  @Field(() => GraphQLISODateTime, { nullable: true })
  customerConfirmedAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  professionalConfirmedAt!: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
