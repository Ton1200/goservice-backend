import { DomainException } from '../../common/errors/domain-exception';

const CARD_PAYMENT_MODULE_DISABLED_CODE = 'CARD_PAYMENT_MODULE_DISABLED';

/**
 * Thrown by `CardPaymentModuleEnabledGuard` when the
 * `payments.payment-methods.mercadopago.card.enabled` `PlatformSetting` currently
 * resolves to `false` — the GLOBAL kill switch for card payments
 * (`payEngagementWithCard`). Unlike Cash Payment this switch is seeded OFF: a
 * real end-to-end card charge is not certified for production yet.
 */
export function cardPaymentModuleDisabled(): DomainException {
  return new DomainException(
    CARD_PAYMENT_MODULE_DISABLED_CODE,
    'Card Payment is currently disabled.',
  );
}
