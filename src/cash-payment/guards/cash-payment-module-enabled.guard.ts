import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { cashPaymentModuleDisabled } from '../errors/cash-payment-module-disabled.error';

// Top-level `payments.*` namespace, nested under a `payment-methods` group
// (2026-09-14 follow-up, human-requested settings-IA reorganization) — a
// sibling of `payments.general-settings.commission.percent` (GOS-109/
// DEC-008), not nested under `customer.*`: Cash Payment is a payments-domain
// capability, not a Customer-app-only concern (both parties confirm).
// `payment-methods` exists specifically so a future method (card, GOS-79)
// joins as a SIBLING leaf under the same group instead of piling up as
// another bare top-level block next to Commission — see
// `payments.general-settings.commission.percent`'s own comment for the
// matching "General Settings" group this key deliberately does NOT belong
// under. Renders under Payments > "Payment Methods" > "Cash" in the admin
// panel's settings tree with zero frontend changes, same
// dot-path-derivation mechanism every other module-enabled key already
// relies on. RENAMED (2026-09-14) from the flatter `payments.cash.enabled`
// — the existing `PlatformSetting` row was renamed in place (same id/value),
// never re-seeded as a duplicate.
export const CASH_PAYMENT_ENABLED_KEY = 'payments.payment-methods.cash.enabled';

/**
 * The GLOBAL kill switch for the Cash Payment capability
 * (`confirmCashPayment` only) — reads the
 * `payments.payment-methods.cash.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled`. Mirrors
 * `AppointmentsModuleEnabledGuard`/`QuoteNegotiationModuleEnabledGuard`
 * exactly (same mechanism, same guard-ordering convention).
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * CashPaymentModuleEnabledGuard)` on `confirmCashPayment` only, in that
 * exact order. `myPendingCashCommissionDebt` is deliberately NOT behind this
 * guard — it only reads `LedgerEntry` rows that already exist; a kill switch
 * meant to stop NEW cash-payment confirmations during an incident has no
 * reason to also hide a Professional's own already-recorded debt.
 */
@Injectable()
export class CashPaymentModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      CASH_PAYMENT_ENABLED_KEY,
    );
    if (!enabled) {
      throw cashPaymentModuleDisabled();
    }
    return true;
  }
}
