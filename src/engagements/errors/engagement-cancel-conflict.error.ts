import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_CANCEL_CONFLICT_CODE = 'ENGAGEMENT_CANCEL_CONFLICT';

/**
 * Thrown by `CancelEngagementByCustomerService` when its guarded CAS
 * `updateMany` (`WHERE id = X AND status IN ('ACCEPTED','IN_PROGRESS')` ->
 * `CANCELLED`) reports `count !== 1` — this call LOST a race (e.g. the
 * Professional's `startEngagementWork`/`markEngagementWorkFinished`, or a
 * second concurrent cancel) even though the pre-read looked fine a moment
 * earlier. The whole `prisma.$transaction` rolls back.
 *
 * NOT anti-enumeration: a legitimate, expected outcome of concurrent access
 * to a resource the caller is already allowed to see. Mirrors
 * `engagementWorkStartConflict()` / `engagementCompletionConflict()`'s
 * "generic, non-enumerating conflict code for a lost CAS race" idiom.
 * Deliberately DISTINCT from `ENGAGEMENT_NOT_CANCELLABLE_BY_CUSTOMER` (the
 * plain pre-read wrong-state case, no race).
 */
export function engagementCancelConflict(): DomainException {
  return new DomainException(
    ENGAGEMENT_CANCEL_CONFLICT_CODE,
    'This Engagement could not be cancelled — its state changed concurrently.',
  );
}
