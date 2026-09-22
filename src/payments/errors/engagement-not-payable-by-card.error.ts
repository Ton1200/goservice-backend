import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_PAYABLE_BY_CARD_CODE = 'ENGAGEMENT_NOT_PAYABLE_BY_CARD';

/**
 * Thrown by `PayEngagementWithCardService` when the Engagement is not
 * `IN_PROGRESS`, `PENDING_CUSTOMER_CONFIRMATION` or `COMPLETED` (the same
 * window as `confirmCashPayment`, GOS-87 — a documented product decision,
 * confirmed with the requester, not ticket-specified), or when its payment
 * method was already fixed to CASH. ONE code for every disallowed case, same
 * "single precheck error" convention `engagementNotConfirmableForCashPayment()`
 * already establishes.
 */
export function engagementNotPayableByCard(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_PAYABLE_BY_CARD_CODE,
    'This Engagement cannot be paid by card right now.',
  );
}
