import { Injectable } from '@nestjs/common';
import {
  EngagementReviewParty,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ReviewModel } from '../models/review.model';
import { ReviewsRepository, ReviewWithEngagement } from '../reviews.repository';

// Candidate for a `PlatformSetting` later — DEC-002 is still `Proposed`
// (see `domain-model.md`) — hardcoded here deliberately: this ticket does
// not invent a new configuration mechanism just for this one window.
const REVIEW_DOUBLE_BLIND_WINDOW_DAYS = 14;
const REVIEW_DOUBLE_BLIND_WINDOW_MS =
  REVIEW_DOUBLE_BLIND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Orchestrates `Query.myReceivedReviews` — every Review the caller has
 * RECEIVED (authored by their counterparty), whose double-blind has
 * resolved. Deliberately NOT gated by `ReviewsModuleEnabledGuard` — see
 * that guard's own header comment; turning off NEW submissions must never
 * hide reviews a caller already received.
 *
 * 1. Resolves BOTH of the caller's possible profile ids in parallel (a User
 *    may hold a `CustomerProfile`, a `ProfessionalProfile`, both, or
 *    neither — if neither, returns `[]`, never an error).
 * 2. One repository call (`findManyForPartyWithOwnReviews`) brings back
 *    EVERY Review on EVERY Engagement the caller is a party to — BOTH the
 *    caller's own review and the one they received, unfiltered by
 *    `authorRole` — pushing the "party" union into the WHERE clause rather
 *    than merging two separately-sorted lists in memory (there is no
 *    precedent in this codebase for merge-and-sort; this design avoids
 *    needing one).
 * 3. Grouped by `engagementId` in memory; for each engagement, whichever
 *    row's `authorRole` matches the CALLER's own role on that specific
 *    Engagement is "mine", the other is "received".
 * 4. **Double-blind resolution** — `doubleBlindResolved` when EITHER the
 *    caller has already submitted their own review for this Engagement, OR
 *    `Engagement.completedAt` is at least `REVIEW_DOUBLE_BLIND_WINDOW_DAYS`
 *    (14) in the past. **Decision, stated explicitly**: until the
 *    double-blind resolves, the ENTIRE received Review is omitted from the
 *    result — not just its `comment`. The ticket's own wording ("el rating
 *    siempre es visible una vez resuelto el doble ciego") only speaks to
 *    what happens AFTER resolution; DEC-002's traditional double-blind
 *    framing (neither side sees ANYTHING about the other's rating until
 *    both have rated or the window lapses) is the interpretation applied
 *    here, not "hide only the comment, but reveal the rating early".
 * 5. Once resolved: `rating` is ALWAYS visible (independent of comment
 *    moderation); `comment` is visible only when
 *    `commentModerationStatus === APPROVED` — `PENDING`/`REJECTED` both
 *    render as `null` on this public model (the distinction between them
 *    is admin-only, via `AdminReviewModel`).
 */
@Injectable()
export class ListMyReceivedReviewsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly reviewsRepository: ReviewsRepository,
  ) {}

  async listReceived(userId: string): Promise<ReviewModel[]> {
    const [customerProfile, professionalProfile] = await Promise.all([
      this.profilesRepository.findCustomerProfileByUserId(userId),
      this.profilesRepository.findProfessionalProfileByUserId(userId),
    ]);

    const customerProfileId = customerProfile?.id ?? null;
    const professionalProfileId = professionalProfile?.id ?? null;
    if (!customerProfileId && !professionalProfileId) {
      return [];
    }

    const rows = await this.reviewsRepository.findManyForPartyWithOwnReviews(
      customerProfileId,
      professionalProfileId,
    );

    const rowsByEngagementId = new Map<string, ReviewWithEngagement[]>();
    for (const row of rows) {
      const existing = rowsByEngagementId.get(row.engagementId) ?? [];
      existing.push(row);
      rowsByEngagementId.set(row.engagementId, existing);
    }

    const now = Date.now();
    const results: ReviewModel[] = [];

    for (const engagementRows of rowsByEngagementId.values()) {
      const { engagement } = engagementRows[0];
      const callerRole =
        customerProfileId && engagement.customerProfileId === customerProfileId
          ? EngagementReviewParty.CUSTOMER
          : professionalProfileId &&
              engagement.professionalProfileId === professionalProfileId
            ? EngagementReviewParty.PROFESSIONAL
            : null;
      if (!callerRole) {
        // Defensive — the repository query already scopes rows to
        // Engagements the caller is party to; this should never happen.
        continue;
      }

      const ownReview = engagementRows.find(
        (row) => row.authorRole === callerRole,
      );
      const receivedReview = engagementRows.find(
        (row) => row.authorRole !== callerRole,
      );
      if (!receivedReview) {
        continue;
      }

      const windowElapsed =
        engagement.completedAt !== null &&
        now - engagement.completedAt.getTime() >= REVIEW_DOUBLE_BLIND_WINDOW_MS;
      const doubleBlindResolved = Boolean(ownReview) || windowElapsed;
      if (!doubleBlindResolved) {
        continue;
      }

      const commentVisible =
        receivedReview.commentModerationStatus ===
        ReviewCommentModerationStatus.APPROVED;

      const model = new ReviewModel();
      model.id = receivedReview.id;
      model.engagementId = receivedReview.engagementId;
      model.authorRole = receivedReview.authorRole;
      model.rating = receivedReview.rating;
      model.comment = commentVisible ? receivedReview.comment : null;
      model.createdAt = receivedReview.createdAt;
      results.push(model);
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }
}
