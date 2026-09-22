import { registerEnumType } from '@nestjs/graphql';
import { ReviewCommentModerationStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `ReviewCommentModerationStatus` enum
 * directly as a GraphQL enum type. ADMIN-ONLY — never exposed on the public
 * `ReviewModel` (see that class's own header comment); only
 * `AdminReviewModel`/`AdminReviewsFilterInput`
 * (`src/platform-admin/reviews/`) reference it. `PENDING` is the only
 * non-terminal state; `APPROVED`/`REJECTED` are both terminal — never
 * reverted, never resubmitted (see `reviewCommentAlreadyModerated()`'s own
 * comment).
 */
registerEnumType(ReviewCommentModerationStatus, {
  name: 'ReviewCommentModerationStatus',
  description:
    'PENDING while awaiting admin moderation; APPROVED/REJECTED once an admin decides. Both terminal — never reverted or resubmitted. NULL on the Review itself means there is no comment to moderate.',
});

export { ReviewCommentModerationStatus };
