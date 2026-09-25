import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { PaymentMethod } from '../../ledger/models/payment-method.enum';
import { PaymentAttemptType } from './payment-attempt-type.enum';

/**
 * A card the Customer saved for future payments (GOS-146: Rapyd; GOS-149:
 * Mercado Pago) — exactly what a wallet screen shows ("Visa •••• 1111,
 * expires 12/2030"). NOTHING sensitive exists here or anywhere in GoService:
 * no card number, CVV or holder name (they never leave the provider's own
 * widget/SDK). A Rapyd card's provider token is deliberately NOT exposed (it
 * is a one-tap, server-side chargeable reference). A Mercado Pago card's
 * `providerCardId` IS (GOS-150 follow-up): the client cannot re-tokenize the
 * CVV without it, and on its own it charges nothing — see the field.
 */
@ObjectType('SavedCard')
export class SavedCardModel {
  @Field(() => ID)
  id!: string;

  @Field(() => PaymentMethod, {
    description:
      'Which provider this card is saved with — RAPYD pays in one tap; MERCADOPAGO requires the CVV to be re-entered (and re-tokenized client-side into payEngagementWithSavedCard.providerToken) on every charge. Never CASH.',
  })
  method!: PaymentMethod;

  @Field(() => String, {
    nullable: true,
    description:
      'Card brand as the provider reports it, lowercased (e.g. "visa", "mastercard").',
  })
  brand!: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'The last four digits of the card number.',
  })
  lastFour!: string | null;

  @Field(() => PaymentAttemptType, {
    nullable: true,
    description:
      'CREDIT_CARD or DEBIT_CARD when the provider reports it, otherwise null.',
  })
  type!: PaymentAttemptType | null;

  @Field(() => Int, { nullable: true, description: 'Expiry month, 1-12.' })
  expirationMonth!: number | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Expiry year, four digits.',
  })
  expirationYear!: number | null;

  @Field(() => String, {
    nullable: true,
    description:
      "MERCADOPAGO ONLY (null for any other provider): Mercado Pago's own id for this stored card — the `card_id` the client tokenizes together with the CVV the Customer just typed (`{ card_id, security_code }`, Mercado Pago's client-side card_tokens with the public key) into payEngagementWithSavedCard.providerToken. A reference, not a credential: it cannot be charged without that fresh CVV token, and never reaches another Customer (mySavedCards is session-scoped). Never display it.",
  })
  providerCardId!: string | null;

  @Field()
  createdAt!: Date;
}
