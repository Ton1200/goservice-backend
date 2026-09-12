import { Logger } from '@nestjs/common';
import {
  EngagementReviewParty,
  EngagementStatus,
  Prisma,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  ReviewsAccessService,
  ReviewsPartyResolution,
} from '../reviews-access.service';
import { ReviewsRepository } from '../reviews.repository';
import { SubmitEngagementReviewService } from './submit-engagement-review.service';

describe('SubmitEngagementReviewService', () => {
  function makeParty(
    overrides?: Partial<ReviewsPartyResolution>,
  ): ReviewsPartyResolution {
    return {
      role: EngagementReviewParty.CUSTOMER,
      engagement: {
        id: 'engagement-1',
        status: EngagementStatus.COMPLETED,
      } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: {
    party?: ReviewsPartyResolution;
    resolvePartyRejects?: Error;
    commentsEnabled?: boolean;
    createRejects?: Error;
    createResult?: Record<string, unknown>;
  }) {
    const resolveParty = overrides?.resolvePartyRejects
      ? jest.fn().mockRejectedValue(overrides.resolvePartyRejects)
      : jest.fn().mockResolvedValue(overrides?.party ?? makeParty());
    const reviewsAccessService = {
      resolveParty,
    } as unknown as ReviewsAccessService;

    const isEnabled = jest
      .fn()
      .mockResolvedValue(overrides?.commentsEnabled ?? true);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;

    const defaultCreated = {
      id: 'review-1',
      engagementId: 'engagement-1',
      authorRole: EngagementReviewParty.CUSTOMER,
      rating: 5,
      comment: null,
      createdAt: new Date('2026-09-11T00:00:00.000Z'),
    };
    const create = overrides?.createRejects
      ? jest.fn().mockRejectedValue(overrides.createRejects)
      : jest.fn().mockResolvedValue(overrides?.createResult ?? defaultCreated);
    const reviewsRepository = { create } as unknown as ReviewsRepository;

    const service = new SubmitEngagementReviewService(
      reviewsAccessService,
      platformSettingPort,
      reviewsRepository,
    );

    return { service, resolveParty, isEnabled, create };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('submits a rating-only review (no comment) without touching the comment flag', async () => {
    const { service, isEnabled, create } = makeService();

    const result = await service.submit('user-1', 'engagement-1', 5, null);

    expect(isEnabled).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 5,
        comment: null,
        commentModerationStatus: null,
      }),
    );
    expect(result.rating).toBe(5);
  });

  it('a non-empty comment with reviews.comment.enabled=true is submitted PENDING moderation', async () => {
    const { service, isEnabled, create } = makeService({
      createResult: {
        id: 'review-1',
        engagementId: 'engagement-1',
        authorRole: EngagementReviewParty.CUSTOMER,
        rating: 4,
        comment: 'Excelente trabajo',
        createdAt: new Date(),
      },
    });

    const result = await service.submit(
      'user-1',
      'engagement-1',
      4,
      '  Excelente trabajo  ',
    );

    expect(isEnabled).toHaveBeenCalledWith('reviews.comment.enabled');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: 'Excelente trabajo',
        commentModerationStatus: ReviewCommentModerationStatus.PENDING,
      }),
    );
    // The author's OWN response always shows the real comment verbatim —
    // moderation visibility never applies to the author's own response.
    expect(result.comment).toBe('Excelente trabajo');
  });

  it('a whitespace-only comment is treated as no comment — never checks the flag', async () => {
    const { service, isEnabled, create } = makeService();

    await service.submit('user-1', 'engagement-1', 5, '   ');

    expect(isEnabled).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ comment: null, commentModerationStatus: null }),
    );
  });

  it('throws REVIEW_COMMENTS_DISABLED when a non-empty comment is submitted while reviews.comment.enabled=false — never silently drops it', async () => {
    const { service, create } = makeService({ commentsEnabled: false });

    await expect(
      service.submit('user-1', 'engagement-1', 5, 'Buen trabajo'),
    ).rejects.toMatchObject({ code: 'REVIEW_COMMENTS_DISABLED' });
    expect(create).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_COMPLETED when the Engagement is not COMPLETED', async () => {
    const { service, create } = makeService({
      party: makeParty({
        engagement: {
          id: 'engagement-1',
          status: EngagementStatus.ACCEPTED,
        } as never,
      }),
    });

    await expect(
      service.submit('user-1', 'engagement-1', 5, null),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_COMPLETED' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([0, -1, 6, 3.5])(
    'throws INVALID_REVIEW_RATING for rating=%p',
    async (rating) => {
      const { service, create } = makeService();

      await expect(
        service.submit('user-1', 'engagement-1', rating, null),
      ).rejects.toMatchObject({ code: 'INVALID_REVIEW_RATING' });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('propagates ENGAGEMENT_NOT_FOUND (anti-enumeration) from ReviewsAccessService for a third party', async () => {
    const { service } = makeService({
      resolvePartyRejects: Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    });

    await expect(
      service.submit('third-party-user', 'engagement-1', 5, null),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it('a second submission for the same Engagement/role (P2002) is rejected with ENGAGEMENT_REVIEW_ALREADY_SUBMITTED', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const { service } = makeService({ createRejects: p2002 });

    await expect(
      service.submit('user-1', 'engagement-1', 5, null),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_REVIEW_ALREADY_SUBMITTED' });
  });

  it('rethrows an unrelated Prisma error untouched', async () => {
    const other = new Prisma.PrismaClientKnownRequestError('Other', {
      code: 'P2025',
      clientVersion: '6.19.3',
    });
    const { service } = makeService({ createRejects: other });

    await expect(
      service.submit('user-1', 'engagement-1', 5, null),
    ).rejects.toBe(other);
  });
});
