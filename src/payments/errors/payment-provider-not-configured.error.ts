import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_PROVIDER_NOT_CONFIGURED_CODE = 'PAYMENT_PROVIDER_NOT_CONFIGURED';

/**
 * Thrown when the chosen payment provider (Rapyd) has no complete
 * configuration (credentials and/or environment missing or invalid, or the
 * credentials were rejected) — a fail-closed server-misconfiguration error, the
 * multi-provider sibling of `paymentProviderMisconfigured()`: same admin fix,
 * but with a provider-neutral code so the client can offer another provider
 * instead of a generic "not configured" dead end. Never reveals WHICH setting
 * is missing.
 */
export function paymentProviderNotConfigured(): DomainException {
  return new DomainException(
    PAYMENT_PROVIDER_NOT_CONFIGURED_CODE,
    'This payment provider is not configured yet.',
  );
}
