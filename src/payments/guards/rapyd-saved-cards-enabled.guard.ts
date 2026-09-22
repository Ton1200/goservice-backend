import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { rapydModuleDisabled } from '../errors/rapyd-module-disabled.error';
import { rapydSavedCardsDisabled } from '../errors/rapyd-saved-cards-disabled.error';

/**
 * GOS-146 — the switch of the SAVED-CARDS feature of the Rapyd payment method.
 * It is a feature OF Rapyd, not a separate method: it is effective only while
 * BOTH `payments.payment-methods.rapyd.enabled` and
 * `payments.payment-methods.rapyd.saved-cards-enabled` are ON (turning Rapyd
 * off turns saved cards off with it; turning saved cards off leaves Rapyd's
 * normal checkout untouched). `PlatformSettingPort.isEnabled` is FAIL-OPEN for
 * a missing row, so "off until certified" is guaranteed by the seed.
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * RapydSavedCardsEnabledGuard)` on `mySavedCards` and
 * `payEngagementWithSavedCard`. Deliberately NOT on `deleteSavedCard`: a
 * Customer can always erase a stored card, even after the feature was turned
 * off.
 */
@Injectable()
export class RapydSavedCardsEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.rapyd.enabled,
      ))
    ) {
      throw rapydModuleDisabled();
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.rapyd.savedCardsEnabled,
      ))
    ) {
      throw rapydSavedCardsDisabled();
    }
    return true;
  }
}
