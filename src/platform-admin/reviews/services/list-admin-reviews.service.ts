import { Injectable } from '@nestjs/common';
import { ReviewsRepository } from '../../../reviews/reviews.repository';
import { AdminReviewsFilterInput } from '../models/admin-reviews-filter-input.model';
import { AdminReviewsPageModel } from '../models/admin-reviews-page.model';
import { toAdminReviewModel } from '../models/to-admin-review-model.util';

const DEFAULT_LIMIT = 50;
// Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
// `ListAdminServiceRequestsService`.
const MAX_LIMIT = 200;

/**
 * Orchestrates `Query.adminReviews`. **Deliberately NOT gated by
 * `reviews.rating.enabled`/`reviews.comment.enabled`** — an admin must be
 * able to audit/moderate every Review (including a `PENDING` comment)
 * regardless of whether either flag is currently on, e.g. a comment
 * submitted while enabled still needs resolving even after an admin later
 * disables the flag. Same choice already made for `adminEngagementChatThread`
 * (not gated by a flag) — the opposite of `adminQuoteNegotiationThread`
 * (which IS gated); both are legitimate precedents in this codebase, this
 * surface follows the former. Returns EVERY Review, `PENDING`/`REJECTED`
 * comments included — never redacted for this audience (see
 * `toAdminReviewModel`'s own comment).
 */
@Injectable()
export class ListAdminReviewsService {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  async listReviews(
    filter?: AdminReviewsFilterInput,
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminReviewsPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const repositoryFilter = filter
      ? {
          commentModerationStatus: filter.commentModerationStatus,
          engagementId: filter.engagementId,
          professionalProfileId: filter.professionalProfileId,
        }
      : undefined;

    const [rows, totalCount] = await Promise.all([
      this.reviewsRepository.findManyForAdmin(repositoryFilter, limit, offset),
      this.reviewsRepository.countForAdmin(repositoryFilter),
    ]);

    const page = new AdminReviewsPageModel();
    page.items = rows.map(toAdminReviewModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
