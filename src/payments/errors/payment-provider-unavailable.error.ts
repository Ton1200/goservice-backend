import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_PROVIDER_UNAVAILABLE_CODE = 'PAYMENT_PROVIDER_UNAVAILABLE';

/**
 * Thrown when the provider could not be reached or answered with a server
 * error, so whether a charge exists is UNKNOWN. The `PaymentAttempt`
 * deliberately stays PENDING (it is reconciled by the provider's
 * notification); the Customer is told to check back rather than to retry.
 */
export function paymentProviderUnavailable(): DomainException {
  return new DomainException(
    PAYMENT_PROVIDER_UNAVAILABLE_CODE,
    'The payment provider is temporarily unavailable. Your card may not have been charged — please check again shortly before retrying.',
  );
}
