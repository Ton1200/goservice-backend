import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MAPS_ENABLED_KEY } from '../constants/maps-setting-keys.constants';
import { mapsModuleDisabled } from '../errors/maps-module-disabled.error';

/**
 * The GLOBAL kill switch for the Maps capability (every `Address`
 * query/mutation) — reads the `maps.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled`. Structural mirror of
 * `CardPaymentModuleEnabledGuard`
 * (`src/payments/guards/card-payment-module-enabled.guard.ts`): seeded
 * `false` (`prisma/seed.ts`) — off until an admin turns it on (and, once a
 * server-side Maps usage exists, until `maps.google.api-key` is
 * configured). `PlatformSettingPort.isEnabled` is FAIL-OPEN for a missing
 * row, so "off until enabled" is guaranteed by the seed, not by this guard
 * — the same documented trade-off `CardPaymentModuleEnabledGuard` inherits
 * from the shared port.
 *
 * Applied via `@UseGuards(SessionGuard, MapsModuleEnabledGuard)` on every
 * `AddressesResolver` operation, in that order.
 */
@Injectable()
export class MapsModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(MAPS_ENABLED_KEY);
    if (!enabled) {
      throw mapsModuleDisabled();
    }
    return true;
  }
}
