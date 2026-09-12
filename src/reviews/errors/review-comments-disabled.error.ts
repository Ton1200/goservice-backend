import { DomainException } from '../../common/errors/domain-exception';

const REVIEW_COMMENTS_DISABLED_CODE = 'REVIEW_COMMENTS_DISABLED';

/**
 * Thrown by `SubmitEngagementReviewService` when the caller supplied a
 * non-empty `comment` but the `reviews.comment.enabled` `PlatformSetting`
 * currently resolves to `false` — independent of `reviews.rating.enabled`
 * (the module-wide guard): a rating-only submission still succeeds while
 * this flag is off. The comment is NEVER silently dropped — same "the whole
 * mutation fails explicitly instead" discipline `quotePriceProposalDisabled()`
 * already establishes for its own role-specific flag.
 */
export function reviewCommentsDisabled(): DomainException {
  return new DomainException(
    REVIEW_COMMENTS_DISABLED_CODE,
    'Review comments are currently disabled — submit a rating without a comment instead.',
  );
}
