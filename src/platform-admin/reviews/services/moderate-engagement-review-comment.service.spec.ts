import { Logger } from '@nestjs/common';
import {
  EngagementReviewParty,
  ReviewCommentModerationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReviewsRepository } from '../../../reviews/reviews.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { ReviewModerationDecision } from '../models/review-moderation-decision.enum';
import { ModerateEngagementReviewCommentService } from './moderate-engagement-review-comment.service';

describe('ModerateEngagementReviewCommentService', () => {
  const pendingReview = {
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

  function makeService(overrides?: {
    review?: typeof pendingReview | null;
    updated?: Partial<typeof pendingReview>;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByIdForAdmin = jest
      .fn()
      .mockResolvedValue(
        overrides?.review === undefined ? pendingReview : overrides.review,
      );
    const updateModeration = jest.fn().mockResolvedValue({
      ...pendingReview,
      commentModerationStatus: ReviewCommentModerationStatus.APPROVED,
      moderatedByAdminUserId: 'admin-1',
      moderatedAt: new Date(),
      ...overrides?.updated,
    });
    const reviewsRepository = {
      findByIdForAdmin,
      updateModeration,
    } as unknown as ReviewsRepository;

    const write = jest.fn().mockResolvedValue(undefined);
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new ModerateEngagementReviewCommentService(
      prisma,
      reviewsRepository,
      auditLogRepository,
    );

    return {
      service,
      $transaction,
      findByIdForAdmin,
      updateModeration,
      write,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('approves a PENDING comment and writes an AdminAuditLog row in the same transaction', async () => {
    const { service, updateModeration, write } = makeService();

    const result = await service.moderate(
      'admin-1',
      'review-1',
      ReviewModerationDecision.APPROVE,
    );

    expect(updateModeration).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'review-1',
      expect.objectContaining({
        commentModerationStatus: ReviewCommentModerationStatus.APPROVED,
        moderatedByAdminUserId: 'admin-1',
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'REVIEW_COMMENT_APPROVED',
        targetType: 'Review',
        targetKey: 'review-1',
      }),
    );
    expect(result.commentModerationStatus).toBe(
      ReviewCommentModerationStatus.APPROVED,
    );
  });

  it('rejects a PENDING comment and logs REVIEW_COMMENT_REJECTED', async () => {
    const { service, updateModeration, write } = makeService({
      updated: {
        commentModerationStatus: ReviewCommentModerationStatus.REJECTED,
      },
    });

    await service.moderate(
      'admin-1',
      'review-1',
      ReviewModerationDecision.REJECT,
    );

    expect(updateModeration).toHaveBeenCalledWith(
      expect.anything(),
      'review-1',
      expect.objectContaining({
        commentModerationStatus: ReviewCommentModerationStatus.REJECTED,
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'REVIEW_COMMENT_REJECTED' }),
    );
  });

  it('throws REVIEW_NOT_FOUND for a nonexistent review and never opens a transaction', async () => {
    const { service, $transaction } = makeService({ review: null });

    await expect(
      service.moderate('admin-1', 'nope', ReviewModerationDecision.APPROVE),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    ReviewCommentModerationStatus.APPROVED,
    ReviewCommentModerationStatus.REJECTED,
  ])(
    'throws REVIEW_COMMENT_ALREADY_MODERATED when already %s, and never opens a transaction',
    async (commentModerationStatus) => {
      const { service, $transaction } = makeService({
        review: { ...pendingReview, commentModerationStatus },
      });

      await expect(
        service.moderate(
          'admin-1',
          'review-1',
          ReviewModerationDecision.APPROVE,
        ),
      ).rejects.toMatchObject({ code: 'REVIEW_COMMENT_ALREADY_MODERATED' });
      expect($transaction).not.toHaveBeenCalled();
    },
  );
});
