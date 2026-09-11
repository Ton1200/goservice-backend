import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_COMPLETION_CONFLICT_CODE = 'ENGAGEMENT_COMPLETION_CONFLICT';

/**
 * Thrown by `ConfirmEngagementCompletionService` when its guarded CAS
 * `updateMany` (`WHERE id = X AND status = 'PENDING_CUSTOMER_CONFIRMATION'`
 * -> `COMPLETED`) reports `count !== 1` — this call LOST a race against
 * another concurrent mutation (a double `confirmEngagementCompletion`) even
 * though the pre-read looked fine a moment earlier. The whole
 * `prisma.$transaction` rolls back.
 *
 * NOT anti-enumeration: a legitimate, expected outcome of concurrent access
 * to a resource the caller is already allowed to see. Mirrors
 * `engagementWorkStartConflict()` / `engagementWorkFinishConflict()`'s
 * "generic, non-enumerating conflict code for a lost CAS race" idiom.
 * Deliberately DISTINCT from `ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION`
 * (the plain pre-read wrong-state case, no race).
 */
export function engagementCompletionConflict(): DomainException {
  return new DomainException(
    ENGAGEMENT_COMPLETION_CONFLICT_CODE,
    'This Engagement could not be completed — its state changed concurrently.',
  );
}
