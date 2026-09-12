import { DomainException } from '../../common/errors/domain-exception';

const REVIEW_COMMENT_ALREADY_MODERATED_CODE =
  'REVIEW_COMMENT_ALREADY_MODERATED';

/**
 * Thrown by `ModerateEngagementReviewCommentService` when the target
 * `Review.commentModerationStatus` is anything other than `PENDING` —
 * covers both "already APPROVED" and "already REJECTED", the same "a
 * decision, once made, is never reverted or reconsidered" rule the ticket
 * requires (no un-approve/un-reject, no resubmission of a REJECTED
 * comment — see `domain-model.md`'s own "out of scope" list).
 */
export function reviewCommentAlreadyModerated(): DomainException {
  return new DomainException(
    REVIEW_COMMENT_ALREADY_MODERATED_CODE,
    'This review comment has already been moderated.',
  );
}
