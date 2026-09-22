import { Logger } from '@nestjs/common';
import { ServiceRequestUrgency } from '@prisma/client';
import { AddressesRepository } from '../../addresses/addresses.repository';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PublishServiceRequestInput } from '../models/publish-service-request-input.model';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { PublishServiceRequestService } from './publish-service-request.service';

describe('PublishServiceRequestService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };
  const defaultAddress = { id: 'address-default-1', isDefault: true };
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
    addressId: defaultAddress.id,
    attachments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    existingCategoryIds?: string[];
    usableRefs?: { id: string; fileUrl: string }[];
    defaultAddress?: { id: string } | null;
    ownedAddress?: { id: string } | null;
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

    const findDefaultForCustomerProfile = jest
      .fn()
      .mockResolvedValue(
        overrides?.defaultAddress === undefined
          ? defaultAddress
          : overrides.defaultAddress,
      );
    const findOneOwnedByEitherProfile = jest
      .fn()
      .mockResolvedValue(
        overrides?.ownedAddress === undefined
          ? defaultAddress
          : overrides.ownedAddress,
      );
    const addressesRepository = {
      findDefaultForCustomerProfile,
      findOneOwnedByEitherProfile,
    } as unknown as AddressesRepository;

    const service = new PublishServiceRequestService(
      profilesRepository,
      serviceRequestsRepository,
      addressesRepository,
    );

    return {
      service,
      findCustomerProfileByUserId,
      findExistingCategoryIds,
      findUsablePendingUploadRefs,
      publish,
      findDefaultForCustomerProfile,
      findOneOwnedByEitherProfile,
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

  // GOS-155 — addressId resolution.
  describe('addressId resolution (GOS-155)', () => {
    it("falls back to the caller's own default Address when addressId is omitted", async () => {
      const { service, publish, findDefaultForCustomerProfile } = makeService();

      await service.publishServiceRequest('user-1', validInput());

      expect(findDefaultForCustomerProfile).toHaveBeenCalledWith(
        customerProfile.id,
      );
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: defaultAddress.id }),
      );
    });

    it('throws SERVICE_REQUEST_ADDRESS_REQUIRED when addressId is omitted and the caller has no default Address', async () => {
      const { service } = makeService({ defaultAddress: null });

      await expect(
        service.publishServiceRequest('user-1', validInput()),
      ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_ADDRESS_REQUIRED' });
    });

    it('uses an explicit addressId once ownership under the CUSTOMER profile is confirmed', async () => {
      const explicitAddress = { id: 'address-explicit-1' };
      const {
        service,
        publish,
        findOneOwnedByEitherProfile,
        findDefaultForCustomerProfile,
      } = makeService({ ownedAddress: explicitAddress });

      await service.publishServiceRequest(
        'user-1',
        validInput({ addressId: explicitAddress.id }),
      );

      expect(findOneOwnedByEitherProfile).toHaveBeenCalledWith(
        explicitAddress.id,
        customerProfile.id,
        null,
      );
      expect(findDefaultForCustomerProfile).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: explicitAddress.id }),
      );
    });

    it('throws ADDRESS_NOT_FOUND when the explicit addressId does not resolve under the CUSTOMER profile', async () => {
      const { service } = makeService({ ownedAddress: null });

      await expect(
        service.publishServiceRequest(
          'user-1',
          validInput({ addressId: 'address-not-mine' }),
        ),
      ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
    });
  });
});
