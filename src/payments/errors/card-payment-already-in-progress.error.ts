import { DomainException } from '../../common/errors/domain-exception';

const CARD_PAYMENT_ALREADY_IN_PROGRESS_CODE =
  'CARD_PAYMENT_ALREADY_IN_PROGRESS';

/**
 * Thrown when the Engagement already has a `PaymentAttempt` that is
 * PENDING (a charge in flight, or awaiting the provider's asynchronous
 * notification) or APPROVED (already paid) — the "no double charge" rule.
 * Enforced by the partial unique index on `PaymentAttempt` (see its
 * migration), not by a read-then-write, so it holds under a concurrent double
 * submit too.
 */
export function cardPaymentAlreadyInProgress(): DomainException {
  return new DomainException(
    CARD_PAYMENT_ALREADY_IN_PROGRESS_CODE,
    'This Engagement already has a card payment in progress or already paid.',
  );
}
