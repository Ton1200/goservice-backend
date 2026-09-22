import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { PaymentMethod } from '../../ledger/models/payment-method.enum';
import { PaymentAttemptStatus } from './payment-attempt-status.enum';

/**
 * `payEngagementWithCard`'s return type — a subset of the `PaymentAttempt`
 * row. NOT exposed, on purpose:
 * - `providerPaymentId`: the payment processor's internal identifier; no client
 *   needs it (least exposure).
 * - `providerFeeAmount`/`providerTaxAmount`/`netReceivedAmount` and the
 *   provider's approval/release dates: GoService's own cost and settlement
 *   data — the Customer has no business seeing what GoService pays the
 *   processor.
 * What IS exposed of how it was paid — `method`, `paymentTypeId`, `cardBrand`,
 * `cardLastFour` — is exactly what a receipt shows ("Visa •••• 6260"); all of
 * it is null until the payment is APPROVED and the provider reports it.
 *
 * `rejectionReason` is a small, stable domain code — `CARD_DECLINED`,
 * `INSUFFICIENT_FUNDS`, `INVALID_CARD_DATA`, `PROVIDER_ERROR`, `ABANDONED` (GOS-146,
 * the Customer dropped an unpaid embedded checkout) or `OTHER` —
 * never the processor's raw detail.
 */
@ObjectType('PaymentAttempt')
export class PaymentAttemptModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => PaymentAttemptStatus)
  status!: PaymentAttemptStatus;

  @Field(() => Int, {
    description:
      'The amount charged, in whole units of `currency` (same convention as every other money amount in this API).',
  })
  amount!: number;

  @Field()
  currency!: string;

  @Field(() => Int)
  installments!: number;

  @Field(() => PaymentMethod)
  method!: PaymentMethod;

  @Field(() => String, {
    nullable: true,
    description:
      'What kind of instrument paid: credit_card or debit_card (later also account_money for a Mercado Pago account payment). Null until APPROVED.',
  })
  paymentTypeId!: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'The card brand id the provider reports, e.g. "visa", "master" (debit: "debvisa", "debmaster"). Null until APPROVED, or when not paid by card.',
  })
  cardBrand!: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'The last 4 digits of the card, to show "Visa •••• 6260". Null until APPROVED, or when not paid by card. Never more than 4 digits.',
  })
  cardLastFour!: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Why a REJECTED attempt was not charged: CARD_DECLINED, INSUFFICIENT_FUNDS, INVALID_CARD_DATA, PROVIDER_ERROR, ABANDONED (the Customer dropped an unpaid embedded checkout via abandonEngagementPaymentAttempt), AUTHENTICATION_REQUIRED (a saved card was charged but the issuer demands 3D Secure — nothing was charged; fall back to startEngagementRapydCheckout) or OTHER. Null unless REJECTED.',
  })
  rejectionReason!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
