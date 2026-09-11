import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_ACCEPTED_CODE = 'ENGAGEMENT_NOT_ACCEPTED';

/**
 * Thrown by `StartEngagementWorkService`'s pre-transaction check when the
 * Engagement is no longer in `ACCEPTED` — the caller cannot start work that
 * has already started (`IN_PROGRESS`), already finished
 * (`PENDING_CUSTOMER_CONFIRMATION`), or reached a reserved terminal state.
 * This is the plain "wrong state, non-race" code, deliberately DISTINCT from
 * `ENGAGEMENT_WORK_START_CONFLICT` (a lost CAS race where the pre-read looked
 * fine a moment earlier) — same split `AcceptQuoteService`
 * (`SERVICE_REQUEST_NOT_OPEN`/`QUOTE_NOT_SENT` vs `QUOTE_ACCEPT_CONFLICT`) and
 * `AcceptAppointmentService` (`APPOINTMENT_NOT_PENDING` vs
 * `APPOINTMENT_ACCEPT_CONFLICT`) already establish.
 */
export function engagementNotAccepted(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_ACCEPTED_CODE,
    'This Engagement is not in ACCEPTED — work cannot be started.',
  );
}
