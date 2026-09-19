import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_PROVIDER_MISCONFIGURED_CODE = 'PAYMENT_PROVIDER_MISCONFIGURED';

/**
 * Thrown when the payment provider's credentials/environment are missing or
 * invalid. A fail-closed server-misconfiguration error, mirrors
 * `ledgerCommissionMisconfigured()` — never reveals WHICH credential is
 * missing.
 */
export function paymentProviderMisconfigured(): DomainException {
  return new DomainException(
    PAYMENT_PROVIDER_MISCONFIGURED_CODE,
    'Card payments are not configured yet.',
  );
}
