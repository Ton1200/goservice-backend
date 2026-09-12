import {
  EngagementReviewParty,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { ReviewsRepository } from '../../../reviews/reviews.repository';
import { ListAdminReviewsService } from './list-admin-reviews.service';

describe('ListAdminReviewsService', () => {
  const row = {
    id: 'review-1',
    engagementId: 'engagement-1',
    authorRole: EngagementReviewParty.CUSTOMER,
    authorCustomerProfileId: 'customer-profile-1',
    authorProfessionalProfileId: null,
    rating: 4,
    comment: 'Buen trabajo',
    commentModerationStatus: ReviewCommentModerationStatus.PENDING,
    moderatedByAdminUserId: null,
    moderatedAt: null,
    createdAt: new Date(),
  };

  function makeService() {
    const findManyForAdmin = jest.fn().mockResolvedValue([row]);
    const countForAdmin = jest.fn().mockResolvedValue(1);
    const reviewsRepository = {
      findManyForAdmin,
      countForAdmin,
    } as unknown as ReviewsRepository;

    const service = new ListAdminReviewsService(reviewsRepository);
    return { service, findManyForAdmin, countForAdmin };
  }

  it('maps rows into AdminReviewModel shape, including moderation fields', async () => {
    const { service } = makeService();

    const page = await service.listReviews();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'review-1',
      rating: 4,
      comment: 'Buen trabajo',
      commentModerationStatus: ReviewCommentModerationStatus.PENDING,
    });
    expect(page.totalCount).toBe(1);
  });

  it('passes the filter through to the repository unchanged', async () => {
    const { service, findManyForAdmin, countForAdmin } = makeService();

    await service.listReviews(
      { commentModerationStatus: ReviewCommentModerationStatus.PENDING },
      10,
      5,
    );

    expect(findManyForAdmin).toHaveBeenCalledWith(
      { commentModerationStatus: ReviewCommentModerationStatus.PENDING },
      10,
      5,
    );
    expect(countForAdmin).toHaveBeenCalledWith({
      commentModerationStatus: ReviewCommentModerationStatus.PENDING,
    });
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listReviews(undefined, 9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 200, 0);
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listReviews();

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 50, 0);
  });
});
