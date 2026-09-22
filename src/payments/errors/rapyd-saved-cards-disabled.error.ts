import { DomainException } from '../../common/errors/domain-exception';

const RAPYD_SAVED_CARDS_DISABLED_CODE = 'RAPYD_SAVED_CARDS_DISABLED';

/**
 * Thrown by `RapydSavedCardsEnabledGuard` when the saved-cards feature of the
 * Rapyd payment method is switched off — its own
 * `payments.payment-methods.rapyd.saved-cards-enabled` `PlatformSetting`
 * resolves to `false`. (When the whole Rapyd method is off the guard throws
 * `RAPYD_MODULE_DISABLED` instead.) Seeded OFF.
 */
export function rapydSavedCardsDisabled(): DomainException {
  return new DomainException(
    RAPYD_SAVED_CARDS_DISABLED_CODE,
    'Saved cards are currently disabled.',
  );
}
