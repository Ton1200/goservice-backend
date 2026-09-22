import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION_CODE =
  'ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION';

/**
 * Thrown by `ConfirmEngagementCompletionService`'s pre-transaction check
 * when the Engagement is no longer in `PENDING_CUSTOMER_CONFIRMATION` — the
 * Customer cannot confirm work that was never marked finished (`ACCEPTED`/
 * `IN_PROGRESS`), has already been confirmed (`COMPLETED`), or is
 * `CANCELLED`. This is the plain "wrong state, non-race" code, deliberately
 * DISTINCT from `ENGAGEMENT_COMPLETION_CONFLICT` (a lost CAS race where the
 * pre-read looked fine a moment earlier) — same split `engagementNotAccepted()`
 * / `engagementNotInProgress()` already establish for GOS-111.
 */
export function engagementNotPendingCustomerConfirmation(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION_CODE,
    'This Engagement is not in PENDING_CUSTOMER_CONFIRMATION — completion cannot be confirmed.',
  );
}
