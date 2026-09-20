import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { walletPaymentModuleDisabled } from '../errors/wallet-payment-module-disabled.error';

// Sibling leaf of `payments.payment-methods.card.enabled` under the same
// `payments.payment-methods` group — same dot-path-derivation mechanism
// every other module-enabled key relies on.
export const MERCADOPAGO_WALLET_PAYMENT_ENABLED_KEY =
  'payments.payment-methods.mercadopago-wallet.enabled';

/**
 * The GLOBAL kill switch for the Mercado Pago Wallet Payment capability
 * (`startEngagementWalletPayment`) — reads the
 * `payments.payment-methods.mercadopago-wallet.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled`. Mirrors `CardPaymentModuleEnabledGuard`
 * exactly (same mechanism, same guard-ordering convention, same
 * seeded-`false` default and the same reasoning: `PlatformSettingPort.isEnabled`
 * is FAIL-OPEN for a missing row, so "off until certified" is guaranteed by
 * the seed, not by this guard).
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * MercadoPagoWalletModuleEnabledGuard)` on `startEngagementWalletPayment`, in
 * that exact order. `myEngagementPaymentAttempt` (a read of already-existing
 * data, same posture as `myPendingCashCommissionDebt`) is deliberately NOT
 * behind this guard, and neither is the asynchronous provider notification —
 * a kill switch meant to stop NEW charges must not also drop the
 * notification that resolves a charge already in flight.
 */
@Injectable()
export class MercadoPagoWalletModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      MERCADOPAGO_WALLET_PAYMENT_ENABLED_KEY,
    );
    if (!enabled) {
      throw walletPaymentModuleDisabled();
    }
    return true;
  }
}
