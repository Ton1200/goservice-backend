import { DomainException } from '../../common/errors/domain-exception';

const INVALID_REVIEW_RATING_CODE = 'INVALID_REVIEW_RATING';

/**
 * Thrown by `SubmitEngagementReviewService` when `rating` is not an integer
 * in `[1, 5]` — validated in the SERVICE, not just trusted from GraphQL's
 * `Int!` type (an `Int!` argument still lets a client send `0`, `-3`, `6`,
 * etc.), same "never trust the wire type alone for a business-rule range"
 * discipline as every other numeric input validated in this codebase's
 * application services.
 */
export function invalidReviewRating(): DomainException {
  return new DomainException(
    INVALID_REVIEW_RATING_CODE,
    'rating must be an integer between 1 and 5.',
  );
}
