import { Logger } from '@nestjs/common';
import { ServiceRequestUrgency } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PublishServiceRequestInput } from '../models/publish-service-request-input.model';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { PublishServiceRequestService } from './publish-service-request.service';

describe('PublishServiceRequestService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };
  const createdServiceRequest = {
    id: 'service-request-1',
    customerProfileId: customerProfile.id,
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Plomería' },
    description: 'Se rompió una cañería en la cocina.',
    urgency: ServiceRequestUrgency.URGENT,
    indicativeBudgetMin: null,
    indicativeBudgetMax: null,
    status: 'OPEN',
    cancelledAt: null,
    attachments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    existingCategoryIds?: string[];
    usableRefs?: { id: string; fileUrl: string }[];
  }) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? customerProfile
          : overrides.customerProfile,
      );
    const findExistingCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.existingCategoryIds ?? ['cat-1']);
    const profilesRepository = {
      findCustomerProfileByUserId,
      findExistingCategoryIds,
    } as unknown as ProfilesRepository;

    const findUsablePendingUploadRefs = jest
      .fn()
      .mockResolvedValue(overrides?.usableRefs ?? []);
    const publish = jest.fn().mockResolvedValue(createdServiceRequest);
    const serviceRequestsRepository = {
      findUsablePendingUploadRefs,
      publish,
    } as unknown as ServiceRequestsRepository;

    const service = new PublishServiceRequestService(
      profilesRepository,
      serviceRequestsRepository,
    );

    return {
      service,
      findCustomerProfileByUserId,
      findExistingCategoryIds,
      findUsablePendingUploadRefs,
      publish,
    };
  }

  function validInput(
    overrides?: Partial<PublishServiceRequestInput>,
  ): PublishServiceRequestInput {
    return {
      category: 'cat-1',
      description: 'Se rompió una cañería en la cocina.',
      urgency: ServiceRequestUrgency.URGENT,
      ...overrides,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("creates a ServiceRequest owned by the caller's own CustomerProfile", async () => {
    const { service, publish } = makeService();

    const result = await service.publishServiceRequest('user-1', validInput());

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ customerProfileId: customerProfile.id }),
    );
    expect(result).toBe(createdServiceRequest);
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.publishServiceRequest('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('throws CATEGORY_NOT_FOUND when the category does not exist', async () => {
    const { service } = makeService({ existingCategoryIds: [] });

    await expect(
      service.publishServiceRequest('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('throws INVALID_SERVICE_REQUEST_BUDGET_RANGE when indicativeBudgetMin > indicativeBudgetMax', async () => {
    const { service } = makeService();

    await expect(
      service.publishServiceRequest(
        'user-1',
        validInput({ indicativeBudgetMin: 500, indicativeBudgetMax: 100 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_REQUEST_BUDGET_RANGE' });
  });

  it('allows only one of indicativeBudgetMin/indicativeBudgetMax to be set', async () => {
    const { service, publish } = makeService();

    await service.publishServiceRequest(
      'user-1',
      validInput({ indicativeBudgetMin: 500 }),
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        indicativeBudgetMin: 500,
        indicativeBudgetMax: null,
      }),
    );
  });

  it('throws INVALID_ATTACHMENT_UPLOAD_REF when a submitted ref is not usable', async () => {
    const { service } = makeService({ usableRefs: [] });

    await expect(
      service.publishServiceRequest(
        'user-1',
        validInput({ attachmentUploadRefs: ['ref-1'] }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_UPLOAD_REF' });
  });

  it('passes resolved attachment refs to the repository in the client-submitted order', async () => {
    const refA = { id: 'ref-a', fileUrl: 'http://x/a' };
    const refB = { id: 'ref-b', fileUrl: 'http://x/b' };
    // Repository returns them out of order — the service must still hand
    // `publish` the refs in the ORIGINAL `attachmentUploadRefs` order.
    const { service, publish } = makeService({ usableRefs: [refB, refA] });

    await service.publishServiceRequest(
      'user-1',
      validInput({ attachmentUploadRefs: ['ref-a', 'ref-b'] }),
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentRefs: [refA, refB] }),
    );
  });

  it('never queries for attachment refs when none are submitted', async () => {
    const { service, findUsablePendingUploadRefs, publish } = makeService();

    await service.publishServiceRequest('user-1', validInput());

    expect(findUsablePendingUploadRefs).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentRefs: [] }),
    );
  });
});
