import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_IN_PROGRESS_CODE = 'ENGAGEMENT_NOT_IN_PROGRESS';

/**
 * Thrown by `MarkEngagementWorkFinishedService`'s pre-transaction check when
 * the Engagement is not in `IN_PROGRESS` — the Professional cannot mark work
 * finished that was never started (`ACCEPTED`), was already marked finished
 * (`PENDING_CUSTOMER_CONFIRMATION`), or reached a reserved terminal state.
 * The plain "wrong state, non-race" counterpart to
 * `ENGAGEMENT_WORK_FINISH_CONFLICT` (a lost CAS race) — same split as
 * `engagementNotAccepted()` / `appointmentNotPending()`.
 */
export function engagementNotInProgress(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_IN_PROGRESS_CODE,
    'This Engagement is not in IN_PROGRESS — work cannot be marked finished.',
  );
}
