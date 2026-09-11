import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER_CODE =
  'ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER';

/**
 * Thrown by `CancelEngagementByCustomerService`'s pre-transaction check when
 * the Engagement is not currently `ACCEPTED` or `IN_PROGRESS` — i.e. it is
 * already `PENDING_CUSTOMER_CONFIRMATION`, `COMPLETED`, or already
 * `CANCELLED`. Deliberately ONE code covering all three disallowed states
 * (not split per-state, unlike `engagementNotAccepted()` /
 * `engagementNotInProgress()` each guarding a single precondition) — this
 * ticket's own AC calls for a single precheck error here. Deliberately
 * DISTINCT from `ENGAGEMENT_CANCEL_CONFLICT` (a lost CAS race where the
 * pre-read looked fine a moment earlier) — same split every other engagement
 * CAS service already establishes.
 */
export function engagementNotCancellableByCustomer(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER_CODE,
    'This Engagement is not ACCEPTED or IN_PROGRESS — it cannot be cancelled.',
  );
}
