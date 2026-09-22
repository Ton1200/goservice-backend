import { DomainException } from '../../common/errors/domain-exception';

const RAPYD_MODULE_DISABLED_CODE = 'RAPYD_MODULE_DISABLED';

/**
 * Thrown by `RapydModuleEnabledGuard` when the
 * `payments.payment-methods.rapyd.enabled` `PlatformSetting` currently
 * resolves to `false` — the GLOBAL kill switch for Rapyd card payments
 * (`startEngagementRapydCheckout`). Independent of Mercado Pago's own switches
 * (`payments.payment-methods.mercadopago.card.enabled` never governs Rapyd). Seeded OFF.
 */
export function rapydModuleDisabled(): DomainException {
  return new DomainException(
    RAPYD_MODULE_DISABLED_CODE,
    'Rapyd card payments are currently disabled.',
  );
}
