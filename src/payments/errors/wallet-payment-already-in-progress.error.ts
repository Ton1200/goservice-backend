import { DomainException } from '../../common/errors/domain-exception';

const WALLET_PAYMENT_ALREADY_IN_PROGRESS_CODE =
  'WALLET_PAYMENT_ALREADY_IN_PROGRESS';

/**
 * Thrown when the Engagement already has a `PaymentAttempt` that is PENDING
 * (a wallet checkout already started, or awaiting the provider's asynchronous
 * notification) or APPROVED (already paid) — the SAME "no double charge" rule
 * `cardPaymentAlreadyInProgress()` enforces, via the SAME partial unique
 * index on `PaymentAttempt`, just reported with wallet-specific wording so
 * the Customer isn't told "card" for a wallet attempt.
 */
export function walletPaymentAlreadyInProgress(): DomainException {
  return new DomainException(
    WALLET_PAYMENT_ALREADY_IN_PROGRESS_CODE,
    'This Engagement already has a wallet payment in progress or already paid.',
  );
}
