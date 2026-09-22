import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_ATTEMPT_NOT_ABANDONABLE_CODE = 'PAYMENT_ATTEMPT_NOT_ABANDONABLE';

/**
 * Thrown by `abandonEngagementPaymentAttempt` when the Engagement has no
 * abandonable attempt: none is active, it is not an embedded-checkout attempt
 * still PENDING, or the provider already created a payment inside it (money
 * may have moved — that attempt must be resolved by the provider's own answer,
 * never discarded on the Customer's say-so).
 */
export function paymentAttemptNotAbandonable(): DomainException {
  return new DomainException(
    PAYMENT_ATTEMPT_NOT_ABANDONABLE_CODE,
    'This payment attempt cannot be abandoned.',
  );
}
