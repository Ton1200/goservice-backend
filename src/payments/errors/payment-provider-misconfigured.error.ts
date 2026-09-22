import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_PROVIDER_MISCONFIGURED_CODE = 'PAYMENT_PROVIDER_MISCONFIGURED';

/**
 * Thrown when the payment provider's credentials/environment (or, since
 * GOS-142, the wallet checkout's `back_urls`/`notification_url` config) are
 * missing or invalid. A fail-closed server-misconfiguration error, mirrors
 * `ledgerCommissionMisconfigured()` — never reveals WHICH credential/setting
 * is missing.
 *
 * GOS-142: `StartEngagementWalletPaymentService` raises the SAME code — same
 * misconfiguration shape, same admin fix — with its own `message` (found via
 * live testing, 2026-09-19: the default text says "Card payments…", which
 * was silently wrong for a wallet-flow caller before this parameter
 * existed), same reasoning `ledgerCommissionMisconfigured`'s own optional
 * `message` already established.
 */
export function paymentProviderMisconfigured(
  message = 'Card payments are not configured yet.',
): DomainException {
  return new DomainException(PAYMENT_PROVIDER_MISCONFIGURED_CODE, message);
}
