import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { reviewsModuleDisabled } from '../errors/reviews-module-disabled.error';

export const REVIEWS_RATING_ENABLED_KEY = 'reviews.rating.enabled';

/**
 * The GLOBAL kill switch for `submitEngagementReview` — reads the
 * `reviews.rating.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled` (a real, admin-toggleable row — see
 * `prisma/seed.ts`'s own comment), same mechanism as
 * `QuoteNegotiationModuleEnabledGuard`/`EngagementChatModuleEnabledGuard`.
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * ReviewsModuleEnabledGuard)` at the `ReviewsResolver` CLASS level — that
 * resolver carries ONLY `submitEngagementReview`.
 *
 * Deliberately does NOT gate `myReceivedReviews` — that query lives on a
 * SEPARATE resolver class (`ReviewsQueriesResolver`), with only
 * `SessionGuard`/`AccountApprovedGuard` in its chain, no module-enabled
 * guard at all. This is a deliberate divergence from the
 * `EngagementChatResolver` precedent (where the read query DOES share the
 * module guard) — driven by this ticket's own explicit requirement that
 * turning the rating capability off must never hide reviews a caller has
 * already received. See `ReviewsQueriesResolver`'s own header comment.
 */
@Injectable()
export class ReviewsModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      REVIEWS_RATING_ENABLED_KEY,
    );
    if (!enabled) {
      throw reviewsModuleDisabled();
    }
    return true;
  }
}
