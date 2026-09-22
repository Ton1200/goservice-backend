import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { rapydModuleDisabled } from '../errors/rapyd-module-disabled.error';

export const RAPYD_PAYMENT_ENABLED_KEY =
  PAYMENT_METHOD_SETTING_KEYS.rapyd.enabled;

/**
 * GOS-146 — the GLOBAL kill switch for Rapyd card payments
 * (`startEngagementRapydCheckout`) — reads the
 * `payments.payment-methods.rapyd.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled`. Same mechanism, same guard-ordering
 * convention and same "seeded OFF" posture as `CardPaymentModuleEnabledGuard`,
 * and INDEPENDENT of it: Mercado Pago's `card.enabled` never governs Rapyd.
 * `PlatformSettingPort.isEnabled` is FAIL-OPEN for a missing row, so "off until
 * certified" is guaranteed by the seed, not by this guard.
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * RapydModuleEnabledGuard)` on `startEngagementRapydCheckout` ONLY. Deliberately
 * NOT on the Rapyd webhook (a kill switch meant to stop NEW checkouts must not
 * drop the notification that resolves a payment already in flight), on
 * `myEngagementPaymentAttempt`, nor on `abandonEngagementPaymentAttempt` (a
 * Customer must always be able to free the payment slot).
 */
@Injectable()
export class RapydModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      RAPYD_PAYMENT_ENABLED_KEY,
    );
    if (!enabled) {
      throw rapydModuleDisabled();
    }
    return true;
  }
}
