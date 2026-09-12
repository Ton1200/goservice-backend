import { DomainException } from '../../common/errors/domain-exception';

const REVIEW_NOT_FOUND_CODE = 'REVIEW_NOT_FOUND';

/**
 * Thrown by `ModerateEngagementReviewCommentService`
 * (`src/platform-admin/reviews/`) when `reviewId` does not resolve to an
 * existing `Review` — no anti-enumeration concern here (unlike the
 * consumer-facing `engagementNotFound()`): this is an authenticated,
 * permission-gated ADMIN operation, not a caller trying to probe another
 * party's data.
 */
export function reviewNotFound(): DomainException {
  return new DomainException(REVIEW_NOT_FOUND_CODE, 'Review not found.');
}
