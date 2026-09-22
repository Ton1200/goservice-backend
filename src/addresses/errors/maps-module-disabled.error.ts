import { DomainException } from '../../common/errors/domain-exception';

const MAPS_MODULE_DISABLED_CODE = 'MAPS_MODULE_DISABLED';

/**
 * Thrown by `MapsModuleEnabledGuard` when the `maps.enabled` `PlatformSetting`
 * currently resolves to `false` — the GLOBAL kill switch for the Maps
 * capability (`addAddress`/`updateAddress`/`deleteAddress`/
 * `setDefaultAddress`/`myAddresses`). Same pattern as
 * `cardPaymentModuleDisabled()` (`src/payments/errors/`).
 */
export function mapsModuleDisabled(): DomainException {
  return new DomainException(
    MAPS_MODULE_DISABLED_CODE,
    'Maps is currently disabled.',
  );
}
