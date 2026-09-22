import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { cardPaymentModuleDisabled } from '../errors/card-payment-module-disabled.error';
import { mercadoPagoSavedCardsDisabled } from '../errors/mercadopago-saved-cards-disabled.error';

/**
 * GOS-149 — the switch of the SAVED-CARDS feature of the Mercado Pago CARD
 * payment method. Exact mirror of `RapydSavedCardsEnabledGuard`: a feature OF
 * the Mercado Pago card method, not a separate method — effective only while
 * BOTH `payments.payment-methods.mercadopago.card.enabled` and
 * `payments.payment-methods.mercadopago.card.saved-cards-enabled` are ON
 * (turning the card method off turns saved cards off with it; turning saved
 * cards off leaves a normal `payEngagementWithCard` untouched). Independent
 * of Rapyd's own switches — this is solely the Mercado Pago card flow's own
 * feature toggle. `PlatformSettingPort.isEnabled` is FAIL-OPEN for a missing
 * row, so "off until certified" is guaranteed by the seed.
 *
 * NOT applied via `@UseGuards` on the shared `SavedCardResolver` (which now
 * serves cards of more than one provider) — instead checked precisely, once
 * the target card's own provider is known, inside
 * `PayEngagementWithSavedCardService`/`ListMySavedCardsService`. Kept as an
 * injectable `CanActivate` anyway (DI-constructible, its own guard spec) in
 * case a future Mercado-Pago-specific resolver route needs it directly.
 * Deliberately NOT applied to `deleteSavedCard`: a Customer can always erase
 * a stored card, even after the feature was turned off — same rule Rapyd's
 * own guard documents.
 */
@Injectable()
export class MercadoPagoSavedCardsEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.enabled,
      ))
    ) {
      throw cardPaymentModuleDisabled();
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.savedCardsEnabled,
      ))
    ) {
      throw mercadoPagoSavedCardsDisabled();
    }
    return true;
  }
}
