import { DomainException } from '../../common/errors/domain-exception';

const REVIEWS_MODULE_DISABLED_CODE = 'REVIEWS_MODULE_DISABLED';

/**
 * Thrown by `ReviewsModuleEnabledGuard` when the `reviews.rating.enabled`
 * `PlatformSetting` currently resolves to `false` — the GLOBAL kill switch
 * for `submitEngagementReview` (rating AND comment alike). Applied at the
 * `ReviewsResolver` class level, same "one guard, every mutation" convention
 * as `QuoteNegotiationModuleEnabledGuard`/`EngagementChatModuleEnabledGuard`.
 * Deliberately does NOT gate `myReceivedReviews` — see that query's own
 * resolver header comment.
 */
export function reviewsModuleDisabled(): DomainException {
  return new DomainException(
    REVIEWS_MODULE_DISABLED_CODE,
    'Mutual Engagement reviews are currently disabled.',
  );
}
