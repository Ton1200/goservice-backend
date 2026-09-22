import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_CHECKOUT_UNAVAILABLE_CODE = 'PAYMENT_CHECKOUT_UNAVAILABLE';

/**
 * Thrown when an embedded checkout cannot be used or verified right now: the
 * provider answered without a usable checkout, no longer knows the one on
 * file, or could not be re-read when GoService needed its truth before acting
 * (resuming or abandoning an attempt). Nothing is changed — the attempt is
 * left as it was — and the Customer can simply try again shortly.
 */
export function paymentCheckoutUnavailable(): DomainException {
  return new DomainException(
    PAYMENT_CHECKOUT_UNAVAILABLE_CODE,
    'The payment checkout is not available right now. Please try again shortly.',
  );
}
