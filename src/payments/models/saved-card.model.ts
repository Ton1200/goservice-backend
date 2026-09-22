import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { PaymentAttemptType } from './payment-attempt-type.enum';

/**
 * A card the Customer saved for future payments (GOS-146) — exactly what a
 * wallet screen shows ("Visa •••• 1111, expires 12/2030"). NOTHING sensitive
 * exists here or anywhere in GoService: no card number, CVV or holder name (they
 * never leave Rapyd's own widget), and the provider's token is deliberately NOT
 * exposed — the client refers to a card only by this `id`.
 */
@ObjectType('SavedCard')
export class SavedCardModel {
  @Field(() => ID)
  id!: string;

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

  @Field()
  createdAt!: Date;
}
