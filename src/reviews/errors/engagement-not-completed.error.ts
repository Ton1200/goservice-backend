import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_COMPLETED_CODE = 'ENGAGEMENT_NOT_COMPLETED';

/**
 * Thrown by `SubmitEngagementReviewService` when the target Engagement's
 * `status` is anything other than `COMPLETED` — a Review only ever makes
 * sense once the work-execution state machine has actually finished (see
 * `Engagement.completedAt`'s own comment in `prisma/schema.prisma`). Same
 * "plain wrong-state code" shape as `engagementNotAccepted()`/
 * `engagementNotPendingCustomerConfirmation()`.
 */
export function engagementNotCompleted(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_COMPLETED_CODE,
    'This Engagement is not COMPLETED — it cannot be reviewed yet.',
  );
}
