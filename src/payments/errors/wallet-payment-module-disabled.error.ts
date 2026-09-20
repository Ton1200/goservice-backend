import { DomainException } from '../../common/errors/domain-exception';

const WALLET_PAYMENT_MODULE_DISABLED_CODE =
  'MERCADOPAGO_WALLET_MODULE_DISABLED';

/**
 * Thrown by `MercadoPagoWalletModuleEnabledGuard` when the
 * `payments.payment-methods.mercadopago-wallet.enabled` `PlatformSetting`
 * currently resolves to `false` — the GLOBAL kill switch for wallet
 * (redirect-to-Mercado-Pago-account) payments
 * (`startEngagementWalletPayment`). Mirrors `cardPaymentModuleDisabled()`
 * exactly; seeded OFF for the same reason: the redirect/webhook circle has
 * never been completed live (no public HTTPS URL exists yet).
 */
export function walletPaymentModuleDisabled(): DomainException {
  return new DomainException(
    WALLET_PAYMENT_MODULE_DISABLED_CODE,
    'Mercado Pago Wallet Payment is currently disabled.',
  );
}
