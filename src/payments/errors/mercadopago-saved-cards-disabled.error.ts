import { DomainException } from '../../common/errors/domain-exception';

const MERCADOPAGO_SAVED_CARDS_DISABLED_CODE =
  'MERCADOPAGO_SAVED_CARDS_DISABLED';

/**
 * Thrown by `MercadoPagoSavedCardsEnabledGuard` when the saved-cards feature
 * of the Mercado Pago CARD payment method is switched off — its own
 * `payments.payment-methods.mercadopago.card.saved-cards-enabled`
 * `PlatformSetting` resolves to `false`. (When the whole Mercado Pago card
 * method is off the guard throws `CARD_PAYMENT_MODULE_DISABLED` instead —
 * same code `payEngagementWithCard` already uses for that.) Seeded OFF.
 */
export function mercadoPagoSavedCardsDisabled(): DomainException {
  return new DomainException(
    MERCADOPAGO_SAVED_CARDS_DISABLED_CODE,
    'Saved cards are currently disabled.',
  );
}
