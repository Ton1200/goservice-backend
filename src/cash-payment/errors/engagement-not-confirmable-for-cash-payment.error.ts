import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT_CODE =
  'ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT';

/**
 * Thrown by `ConfirmCashPaymentService` when the target `Engagement` is not
 * currently `IN_PROGRESS`, `PENDING_CUSTOMER_CONFIRMATION`, or `COMPLETED` —
 * i.e. it is still `ACCEPTED` (no work has started yet — nothing to have
 * been paid for) or already `CANCELLED`. This is a documented ASSUMPTION,
 * not a rule specified by the GOS-87 ticket itself: it mirrors the "confirm
 * only once real work has begun" reasoning `startEngagementWork`'s own
 * `CONFIRMED Appointment` precondition establishes, but should be validated
 * with UX (see GOS-49/GOS-88) before this scope is treated as final — e.g.
 * whether a Customer should be able to confirm cash payment for an
 * `ACCEPTED` Engagement where a deposit was already handed over in person.
 * Deliberately ONE code covering both disallowed states, same "single
 * precheck error for all excluded states" convention
 * `engagementNotCancellableByCustomer()` already establishes.
 */
export function engagementNotConfirmableForCashPayment(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_CONFIRMABLE_FOR_CASH_PAYMENT_CODE,
    'This Engagement is not IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION, or COMPLETED — cash payment cannot be confirmed yet.',
  );
}
