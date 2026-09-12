import {
  EngagementReviewParty,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ReviewsRepository, ReviewWithEngagement } from '../reviews.repository';
import { ListMyReceivedReviewsService } from './list-my-received-reviews.service';

const CUSTOMER_PROFILE_ID = 'customer-profile-1';
const PROFESSIONAL_PROFILE_ID = 'professional-profile-1';

function row(overrides: Partial<ReviewWithEngagement>): ReviewWithEngagement {
  return {
    id: 'review-x',
    engagementId: 'engagement-1',
    authorRole: EngagementReviewParty.PROFESSIONAL,
    authorCustomerProfileId: null,
    authorProfessionalProfileId: PROFESSIONAL_PROFILE_ID,
    rating: 5,
    comment: null,
    commentModerationStatus: null,
    moderatedByAdminUserId: null,
    moderatedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    engagement: {
      customerProfileId: CUSTOMER_PROFILE_ID,
      professionalProfileId: PROFESSIONAL_PROFILE_ID,
      completedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    ...overrides,
  };
}

describe('ListMyReceivedReviewsService', () => {
  function makeService(overrides?: {
    customerProfile?: { id: string } | null;
    professionalProfile?: { id: string } | null;
    rows?: ReviewWithEngagement[];
  }) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? { id: CUSTOMER_PROFILE_ID }
          : overrides.customerProfile,
      );
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? null
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const findManyForPartyWithOwnReviews = jest
      .fn()
      .mockResolvedValue(overrides?.rows ?? []);
    const reviewsRepository = {
      findManyForPartyWithOwnReviews,
    } as unknown as ReviewsRepository;

    const service = new ListMyReceivedReviewsService(
      profilesRepository,
      reviewsRepository,
    );

    return { service, findManyForPartyWithOwnReviews };
  }

  it('returns [] without querying reviews when the caller has neither profile', async () => {
    const { service, findManyForPartyWithOwnReviews } = makeService({
      customerProfile: null,
      professionalProfile: null,
    });

    const result = await service.listReceived('user-1');

    expect(result).toEqual([]);
    expect(findManyForPartyWithOwnReviews).not.toHaveBeenCalled();
  });

  it('omits the ENTIRE review (not just the comment) when the double-blind has not resolved — no own review yet, and completedAt is recent', async () => {
    const { service } = makeService({
      rows: [
        row({
          authorRole: EngagementReviewParty.PROFESSIONAL,
          engagement: {
            customerProfileId: CUSTOMER_PROFILE_ID,
            professionalProfileId: PROFESSIONAL_PROFILE_ID,
            completedAt: new Date(), // just completed
          },
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toEqual([]);
  });

  it('reveals a received review once the caller has ALSO submitted their own review for that Engagement — even if completedAt is recent', async () => {
    const { service } = makeService({
      rows: [
        row({
          id: 'review-received',
          authorRole: EngagementReviewParty.PROFESSIONAL,
          rating: 4,
          comment: 'Buen cliente',
          commentModerationStatus: ReviewCommentModerationStatus.APPROVED,
          engagement: {
            customerProfileId: CUSTOMER_PROFILE_ID,
            professionalProfileId: PROFESSIONAL_PROFILE_ID,
            completedAt: new Date(),
          },
        }),
        row({
          id: 'review-own',
          authorRole: EngagementReviewParty.CUSTOMER,
          rating: 5,
          engagement: {
            customerProfileId: CUSTOMER_PROFILE_ID,
            professionalProfileId: PROFESSIONAL_PROFILE_ID,
            completedAt: new Date(),
          },
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'review-received',
      rating: 4,
      comment: 'Buen cliente',
    });
  });

  it('reveals a received review once 14 days have passed since completedAt, with no own review submitted', async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const { service } = makeService({
      rows: [
        row({
          id: 'review-received',
          rating: 3,
          engagement: {
            customerProfileId: CUSTOMER_PROFILE_ID,
            professionalProfileId: PROFESSIONAL_PROFILE_ID,
            completedAt: fifteenDaysAgo,
          },
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toHaveLength(1);
    expect(result[0].rating).toBe(3);
  });

  it('rating is always visible once resolved, regardless of comment moderation — PENDING comment renders null', async () => {
    const { service } = makeService({
      rows: [
        row({
          id: 'review-received',
          rating: 2,
          comment: 'Comentario pendiente',
          commentModerationStatus: ReviewCommentModerationStatus.PENDING,
        }),
        row({
          id: 'review-own',
          authorRole: EngagementReviewParty.CUSTOMER,
          rating: 5,
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rating: 2, comment: null });
  });

  it('a REJECTED comment renders null for the counterparty even once resolved', async () => {
    const { service } = makeService({
      rows: [
        row({
          id: 'review-received',
          rating: 1,
          comment: 'Comentario inapropiado',
          commentModerationStatus: ReviewCommentModerationStatus.REJECTED,
        }),
        row({
          id: 'review-own',
          authorRole: EngagementReviewParty.CUSTOMER,
          rating: 5,
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rating: 1, comment: null });
  });

  it('an Engagement with only the caller’s own review (counterparty has not rated yet) contributes nothing', async () => {
    const { service } = makeService({
      rows: [
        row({
          id: 'review-own',
          authorRole: EngagementReviewParty.CUSTOMER,
          rating: 5,
        }),
      ],
    });

    const result = await service.listReceived('user-1');

    expect(result).toEqual([]);
  });

  it('sorts results by createdAt descending across multiple Engagements', async () => {
    const older = row({
      id: 'review-older',
      engagementId: 'engagement-older',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      engagement: {
        customerProfileId: CUSTOMER_PROFILE_ID,
        professionalProfileId: PROFESSIONAL_PROFILE_ID,
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const olderOwn = row({
      id: 'review-older-own',
      engagementId: 'engagement-older',
      authorRole: EngagementReviewParty.CUSTOMER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      engagement: {
        customerProfileId: CUSTOMER_PROFILE_ID,
        professionalProfileId: PROFESSIONAL_PROFILE_ID,
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const newer = row({
      id: 'review-newer',
      engagementId: 'engagement-newer',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      engagement: {
        customerProfileId: CUSTOMER_PROFILE_ID,
        professionalProfileId: PROFESSIONAL_PROFILE_ID,
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });
    const newerOwn = row({
      id: 'review-newer-own',
      engagementId: 'engagement-newer',
      authorRole: EngagementReviewParty.CUSTOMER,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      engagement: {
        customerProfileId: CUSTOMER_PROFILE_ID,
        professionalProfileId: PROFESSIONAL_PROFILE_ID,
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });
    const { service } = makeService({
      rows: [older, olderOwn, newer, newerOwn],
    });

    const result = await service.listReceived('user-1');

    expect(result.map((r) => r.id)).toEqual(['review-newer', 'review-older']);
  });
});
