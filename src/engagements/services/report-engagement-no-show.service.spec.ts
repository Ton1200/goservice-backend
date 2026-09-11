import { Logger } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { ReportEngagementNoShowService } from './report-engagement-no-show.service';

describe('ReportEngagementNoShowService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'customer-user' };
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'professional-user',
  };

  function makeEngagement(
    overrides?: Partial<{
      customerProfileId: string;
      professionalProfileId: string;
      status: EngagementStatus;
    }>,
  ) {
    return {
      id: 'engagement-1',
      serviceRequestId: 'service-request-1',
      quoteId: 'quote-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
      professionalProfileId:
        overrides?.professionalProfileId ?? professionalProfile.id,
      status: overrides?.status ?? EngagementStatus.ACCEPTED,
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      cancelReason: null,
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    professionalProfile?: typeof professionalProfile | null;
    engagement?: ReturnType<typeof makeEngagement> | null;
  }) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? null
          : overrides.customerProfile,
      );
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? null
          : overrides.professionalProfile,
      );
    const incrementCustomerNoShowReportedCount = jest
      .fn()
      .mockResolvedValue(customerProfile);
    const incrementProfessionalNoShowReportedCount = jest
      .fn()
      .mockResolvedValue(professionalProfile);
    const profilesRepository = {
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
      incrementCustomerNoShowReportedCount,
      incrementProfessionalNoShowReportedCount,
    } as unknown as ProfilesRepository;

    const engagement =
      overrides?.engagement === undefined
        ? makeEngagement()
        : overrides.engagement;
    const findById = jest.fn().mockResolvedValue(engagement);
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    const service = new ReportEngagementNoShowService(
      profilesRepository,
      engagementsRepository,
    );

    return {
      service,
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
      incrementCustomerNoShowReportedCount,
      incrementProfessionalNoShowReportedCount,
      findById,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('when the Customer reports, increments only the Professional’s counter, returns the unmodified Engagement, and logs the event', async () => {
    const {
      service,
      incrementProfessionalNoShowReportedCount,
      incrementCustomerNoShowReportedCount,
    } = makeService({ customerProfile });

    const engagement = makeEngagement();
    const result = await service.reportEngagementNoShow(
      'customer-user',
      'engagement-1',
      'never showed up',
    );

    expect(incrementProfessionalNoShowReportedCount).toHaveBeenCalledWith(
      engagement.professionalProfileId,
    );
    expect(incrementCustomerNoShowReportedCount).not.toHaveBeenCalled();
    expect(result.status).toBe(EngagementStatus.ACCEPTED);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'engagement_no_show_reported',
        reportedByRole: 'CUSTOMER',
      }),
    );
  });

  it('when the Professional reports, increments only the Customer’s counter', async () => {
    const {
      service,
      incrementCustomerNoShowReportedCount,
      incrementProfessionalNoShowReportedCount,
    } = makeService({ professionalProfile });

    const engagement = makeEngagement();
    await service.reportEngagementNoShow(
      'professional-user',
      'engagement-1',
      'never showed up',
    );

    expect(incrementCustomerNoShowReportedCount).toHaveBeenCalledWith(
      engagement.customerProfileId,
    );
    expect(incrementProfessionalNoShowReportedCount).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reportedByRole: 'PROFESSIONAL' }),
    );
  });

  it('throws ENGAGEMENT_NOT_FOUND when the caller holds neither profile on this Engagement, and never increments', async () => {
    const {
      service,
      incrementCustomerNoShowReportedCount,
      incrementProfessionalNoShowReportedCount,
    } = makeService();

    await expect(
      service.reportEngagementNoShow('stranger-user', 'engagement-1', 'x'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(incrementCustomerNoShowReportedCount).not.toHaveBeenCalled();
    expect(incrementProfessionalNoShowReportedCount).not.toHaveBeenCalled();
  });

  it('throws ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service } = makeService({
      customerProfile,
      engagement: null,
    });

    await expect(
      service.reportEngagementNoShow('customer-user', 'nope', 'x'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
  });

  it.each([
    EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    EngagementStatus.COMPLETED,
    EngagementStatus.CANCELLED,
  ])(
    'throws ENGAGEMENT_NOT_REPORTABLE_FOR_NO_SHOW when the Engagement is %s, and never increments',
    async (status) => {
      const {
        service,
        incrementCustomerNoShowReportedCount,
        incrementProfessionalNoShowReportedCount,
      } = makeService({
        customerProfile,
        engagement: makeEngagement({ status }),
      });

      await expect(
        service.reportEngagementNoShow('customer-user', 'engagement-1', 'x'),
      ).rejects.toMatchObject({
        code: 'ENGAGEMENT_NOT_REPORTABLE_FOR_NO_SHOW',
      });
      expect(incrementCustomerNoShowReportedCount).not.toHaveBeenCalled();
      expect(incrementProfessionalNoShowReportedCount).not.toHaveBeenCalled();
    },
  );
});
