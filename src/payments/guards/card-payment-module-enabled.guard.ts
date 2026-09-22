import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { cardPaymentModuleDisabled } from '../errors/card-payment-module-disabled.error';

// Sibling leaf of `payments.payment-methods.cash.enabled` under the same
// `payments.payment-methods` group (GOS-87's settings-IA reorganization made
// room for exactly this key), so it renders under Payments > "Payment
// Methods" > "Card" in the admin panel's settings tree with zero frontend
// changes — same dot-path-derivation mechanism every other module-enabled key
// relies on.
export const CARD_PAYMENT_ENABLED_KEY =
  'payments.payment-methods.mercadopago.card.enabled';

/**
 * The GLOBAL kill switch for the Card Payment capability
 * (`payEngagementWithCard`) — reads the `payments.payment-methods.mercadopago.card.enabled`
 * `PlatformSetting` via `PlatformSettingPort.isEnabled`. Mirrors
 * `CashPaymentModuleEnabledGuard` exactly (same mechanism, same
 * guard-ordering convention), with ONE deliberate difference in its DEFAULT:
 *
 * **This switch is seeded `false`** (see `prisma/seed.ts`) — the opposite of
 * cash. `PlatformSettingPort.isEnabled` is FAIL-OPEN for a missing row, so
 * "off until certified" is guaranteed by the seed, not by this guard: a
 * deployment where the seed never ran would have card payments ON. That
 * trade-off is inherited from the shared port and documented there. Card is
 * off by default because DEC-009's research never completed a real end-to-end
 * card charge before GOS-85, and because the provider credentials must be
 * configured first anyway.
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * CardPaymentModuleEnabledGuard)` on `payEngagementWithCard`, in that exact
 * order. The asynchronous provider notification is deliberately NOT behind
 * this guard: a kill switch meant to stop NEW charges during an incident must
 * not also drop the notification that resolves a charge already in flight.
 */
@Injectable()
export class CardPaymentModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      CARD_PAYMENT_ENABLED_KEY,
    );
    if (!enabled) {
      throw cardPaymentModuleDisabled();
    }
    return true;
  }
}
