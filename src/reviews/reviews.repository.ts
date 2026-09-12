import { Injectable } from '@nestjs/common';
import { EngagementReviewParty, Prisma, Review } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const REVIEW_WITH_ENGAGEMENT_INCLUDE = {
  engagement: {
    select: {
      customerProfileId: true,
      professionalProfileId: true,
      completedAt: true,
    },
  },
} satisfies Prisma.ReviewInclude;

export type ReviewWithEngagement = Prisma.ReviewGetPayload<{
  include: typeof REVIEW_WITH_ENGAGEMENT_INCLUDE;
}>;

export interface AdminReviewsFilter {
  commentModerationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  engagementId?: string;
  professionalProfileId?: string;
}

/**
 * The ONLY place in this codebase that issues Prisma queries for `Review` —
 * same data-ownership rule as `EngagementsRepository`/`ProfilesRepository`
 * (see goservice-docs/architecture/backend.md). Reused as a CONCRETE
 * provider class both by `src/profiles/` (`ProfessionalProfileFieldResolver`
 * — `averageRating`/`reviewCount`) and `src/platform-admin/reviews/` —
 * neither imports `ReviewsModule` itself, same "reuse the concrete
 * repository class directly, never import the resolver-bearing Module"
 * pattern this codebase already establishes everywhere.
 */
@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `SubmitEngagementReviewService`'s single write. Deliberately NOT
   * wrapped in a pre-check `findFirst`/transaction here — the unique index
   * `Review_engagementId_authorRole_key` is the whole guarantee; the
   * caller catches the resulting `Prisma.PrismaClientKnownRequestError`
   * (`code === 'P2002'`) itself. See that service's own header comment for
   * why this is the first place in this codebase using that pattern
   * directly instead of a pre-check/CAS.
   */
  create(data: {
    engagementId: string;
    authorRole: EngagementReviewParty;
    authorCustomerProfileId: string | null;
    authorProfessionalProfileId: string | null;
    rating: number;
    comment: string | null;
    commentModerationStatus: 'PENDING' | null;
  }): Promise<Review> {
    return this.prisma.review.create({ data });
  }

  /**
   * `ListMyReceivedReviewsService`'s one query — every Review (BOTH the
   * caller's own and the one they received) on any Engagement where the
   * caller is a party, keyed by EITHER profile id the caller may hold.
   * Deliberately does NOT filter by `authorRole` — the service itself
   * separates "mine" from "received" in memory, per engagement, since it
   * needs both to compute the double-blind resolution (see that service's
   * own header comment). At least one of `customerProfileId`/
   * `professionalProfileId` must be non-null, or this returns everything —
   * the caller (the service) always passes `null` explicitly for whichever
   * profile the User doesn't hold, and this method builds its `OR` clause
   * conditionally to avoid ever issuing that invalid, unbounded query.
   */
  findManyForPartyWithOwnReviews(
    customerProfileId: string | null,
    professionalProfileId: string | null,
  ): Promise<ReviewWithEngagement[]> {
    const or: Prisma.ReviewWhereInput[] = [];
    if (customerProfileId) {
      or.push({ engagement: { customerProfileId } });
    }
    if (professionalProfileId) {
      or.push({ engagement: { professionalProfileId } });
    }
    if (or.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.review.findMany({
      where: { OR: or },
      include: REVIEW_WITH_ENGAGEMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * `ProfessionalProfileFieldResolver.averageRating` — ratings RECEIVED by
   * this Professional (`authorRole: CUSTOMER`, i.e. authored BY the
   * Customer counterparty ON an Engagement where THIS is the
   * professionalProfileId). Counted the instant a rating is submitted,
   * NEVER waiting on comment moderation — rating and comment moderation are
   * independent concerns (see `Review`'s own header comment). `null` when
   * there are zero ratings yet (Prisma's own `_avg` behavior). A dedicated
   * query, not batched — see that resolver's own header comment for why
   * (no N+1 mitigation added speculatively, matching this codebase's
   * existing posture).
   */
  async getAverageRatingForProfessional(
    professionalProfileId: string,
  ): Promise<number | null> {
    const result = await this.prisma.review.aggregate({
      where: {
        authorRole: EngagementReviewParty.CUSTOMER,
        engagement: { professionalProfileId },
      },
      _avg: { rating: true },
    });
    return result._avg.rating;
  }

  getReviewCountForProfessional(
    professionalProfileId: string,
  ): Promise<number> {
    return this.prisma.review.count({
      where: {
        authorRole: EngagementReviewParty.CUSTOMER,
        engagement: { professionalProfileId },
      },
    });
  }

  /**
   * `CustomerProfileFieldResolver.averageRating` — the mirror image of
   * `getAverageRatingForProfessional` above: ratings RECEIVED by this
   * Customer (`authorRole: PROFESSIONAL`, i.e. authored BY the Professional
   * counterparty ON an Engagement where THIS is the customerProfileId).
   * Same "counted immediately, never waiting on comment moderation"
   * semantics — see that method's own comment. Added after the initial
   * GOS-121 ship, human-requested follow-up (only `ProfessionalProfile` had
   * this originally, since that's the side the product vision's
   * "4,8 ★ · 214 trabajos" example and the Quote-comparison flow actually
   * need it for) — same underlying data, just filtered from the other
   * direction, no schema change required.
   */
  async getAverageRatingForCustomer(
    customerProfileId: string,
  ): Promise<number | null> {
    const result = await this.prisma.review.aggregate({
      where: {
        authorRole: EngagementReviewParty.PROFESSIONAL,
        engagement: { customerProfileId },
      },
      _avg: { rating: true },
    });
    return result._avg.rating;
  }

  getReviewCountForCustomer(customerProfileId: string): Promise<number> {
    return this.prisma.review.count({
      where: {
        authorRole: EngagementReviewParty.PROFESSIONAL,
        engagement: { customerProfileId },
      },
    });
  }

  // ---- platform-admin (GOS-121) — `adminReviews`/
  // `moderateEngagementReviewComment` (`src/platform-admin/reviews/`).

  findByIdForAdmin(id: string): Promise<Review | null> {
    return this.prisma.review.findUnique({ where: { id } });
  }

  private buildAdminFilter(
    filter?: AdminReviewsFilter,
  ): Prisma.ReviewWhereInput {
    if (!filter) {
      return {};
    }
    return {
      commentModerationStatus: filter.commentModerationStatus,
      engagementId: filter.engagementId,
      engagement: filter.professionalProfileId
        ? { professionalProfileId: filter.professionalProfileId }
        : undefined,
    };
  }

  findManyForAdmin(
    filter: AdminReviewsFilter | undefined,
    limit: number,
    offset: number,
  ): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: this.buildAdminFilter(filter),
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  countForAdmin(filter?: AdminReviewsFilter): Promise<number> {
    return this.prisma.review.count({ where: this.buildAdminFilter(filter) });
  }

  /**
   * `ModerateEngagementReviewCommentService`'s single write, inside the
   * caller's own `$transaction` (paired with an `AuditLogRepository.write`
   * — same shape as `CreateServiceRequestForCustomerService`). The `PENDING`
   * pre-check happens in the SERVICE, before this is ever called (see that
   * service's own header comment) — this is a plain `update`, not a guarded
   * `updateMany`/CAS, mirroring the plan's own literal "find, check,
   * transaction{update, auditlog}" shape rather than this codebase's
   * Engagement-state-machine CAS convention (which exists for a
   * higher-stakes, higher-concurrency class of transition).
   */
  updateModeration(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      commentModerationStatus: 'APPROVED' | 'REJECTED';
      moderatedByAdminUserId: string;
      moderatedAt: Date;
    },
  ): Promise<Review> {
    return tx.review.update({ where: { id }, data });
  }
}
