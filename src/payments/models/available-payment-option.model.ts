import { Field, ObjectType } from '@nestjs/graphql';
import { PaymentMethod } from '../../ledger/models/payment-method.enum';
import { PaymentOptionKind } from './payment-option-kind.enum';

/**
 * One way an Engagement can be paid right now — an entry of
 * `availablePaymentMethods`. A provider can offer more than one option (Mercado
 * Pago: a card AND a wallet), so `method` alone does not identify the flow:
 * `kind` does.
 */
@ObjectType('AvailablePaymentOption')
export class AvailablePaymentOptionModel {
  @Field(() => PaymentMethod, {
    description: 'The collector — CASH, MERCADOPAGO or RAPYD.',
  })
  method!: PaymentMethod;

  @Field(() => PaymentOptionKind, {
    description:
      'The flow the client must open. Switch on this, never on the provider name.',
  })
  kind!: PaymentOptionKind;

  @Field({
    description:
      'Customer-facing label, configurable by an admin (`payments.payment-methods.<method>.display-name`).',
  })
  displayName!: string;

  @Field({
    description:
      'True when this option lets the Customer save the card for future payments and pay with a saved card (Rapyd, while its saved-cards switch is ON). When true, use mySavedCards / payEngagementWithSavedCard; a card is saved by ticking the box in the embedded widget.',
  })
  supportsSavedCards!: boolean;
}
