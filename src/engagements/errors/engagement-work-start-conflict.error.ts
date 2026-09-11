import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_WORK_START_CONFLICT_CODE = 'ENGAGEMENT_WORK_START_CONFLICT';

/**
 * Thrown by `StartEngagementWorkService` when its guarded CAS `updateMany`
 * (`WHERE id = X AND status = 'ACCEPTED'` -> `IN_PROGRESS`) reports
 * `count !== 1` — this call LOST a race against another concurrent mutation
 * (a double `startEngagementWork`, or a future concurrent cancel) even though
 * the pre-read looked fine a moment earlier. The whole `prisma.$transaction`
 * rolls back.
 *
 * NOT anti-enumeration: a legitimate, expected outcome of concurrent access
 * to a resource the caller is already allowed to see. Mirrors
 * `quoteAcceptConflict()` / `appointmentAcceptConflict()`'s "generic,
 * non-enumerating conflict code for a lost CAS race" idiom. Deliberately
 * DISTINCT from `ENGAGEMENT_NOT_ACCEPTED` (the plain pre-read wrong-state
 * case, no race).
 */
export function engagementWorkStartConflict(): DomainException {
  return new DomainException(
    ENGAGEMENT_WORK_START_CONFLICT_CODE,
    'This Engagement could not be started — its state changed concurrently.',
  );
}
