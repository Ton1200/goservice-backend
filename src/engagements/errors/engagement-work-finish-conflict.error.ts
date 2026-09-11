import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_WORK_FINISH_CONFLICT_CODE = 'ENGAGEMENT_WORK_FINISH_CONFLICT';

/**
 * Thrown by `MarkEngagementWorkFinishedService` when its guarded CAS
 * `updateMany` (`WHERE id = X AND status = 'IN_PROGRESS'` ->
 * `PENDING_CUSTOMER_CONFIRMATION`) reports `count !== 1` — this call LOST a
 * race against another concurrent mutation even though the pre-read looked
 * fine a moment earlier. The whole `prisma.$transaction` rolls back.
 *
 * Same "generic, non-enumerating conflict code for a lost CAS race" idiom as
 * `engagementWorkStartConflict()` / `appointmentAcceptConflict()`.
 * Deliberately DISTINCT from `ENGAGEMENT_NOT_IN_PROGRESS` (the plain pre-read
 * wrong-state case, no race).
 */
export function engagementWorkFinishConflict(): DomainException {
  return new DomainException(
    ENGAGEMENT_WORK_FINISH_CONFLICT_CODE,
    'This Engagement could not be marked finished — its state changed concurrently.',
  );
}
