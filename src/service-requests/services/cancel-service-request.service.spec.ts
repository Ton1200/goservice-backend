import { Logger } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { CancelServiceRequestService } from './cancel-service-request.service';

describe('CancelServiceRequestService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };

  function makeExisting(
    overrides?: Partial<{
      customerProfileId: string;
      status: ServiceRequestStatus;
    }>,
  ) {
    return {
      id: 'service-request-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
      status: overrides?.status ?? ServiceRequestStatus.OPEN,
      category: { id: 'cat-1', name: 'Plomería' },
      attachments: [],
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    existing?: ReturnType<typeof makeExisting> | null;
    cancelCount?: number;
    // Second findById call, only relevant when the CAS (cancel) reports
    // count !== 1 (a lost race) — defaults to `existing` itself.
    reReadExisting?: ReturnType<typeof makeExisting> | null;
  }) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? customerProfile
          : overrides.customerProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
    } as unknown as ProfilesRepository;

    const existing =
      overrides?.existing === undefined ? makeExisting() : overrides.existing;
    const cancelled = {
      ...(existing ?? makeExisting()),
      status: ServiceRequestStatus.CANCELLED,
    };
    const reReadExisting =
      overrides?.reReadExisting === undefined
        ? existing
        : overrides.reReadExisting;

    const findById = jest
      .fn()
      // First call: the pre-read. Second call (only reached on a lost
      // race, count !== 1): the re-read. Third call (only reached on a WON
      // race, count === 1): re-fetch the now-cancelled row.
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(
        overrides?.cancelCount === 0 ? reReadExisting : cancelled,
      );
    const cancel = jest
      .fn()
      .mockResolvedValue({ count: overrides?.cancelCount ?? 1 });
    const serviceRequestsRepository = {
      findById,
      cancel,
    } as unknown as ServiceRequestsRepository;

    const service = new CancelServiceRequestService(
      profilesRepository,
      serviceRequestsRepository,
    );

    return { service, findById, cancel };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("cancels the caller's own OPEN ServiceRequest", async () => {
    const { service, cancel } = makeService();

    const result = await service.cancelServiceRequest(
      'user-1',
      'service-request-1',
    );

    expect(cancel).toHaveBeenCalledWith('service-request-1');
    expect(result.status).toBe(ServiceRequestStatus.CANCELLED);
  });

  it('throws SERVICE_REQUEST_NOT_FOUND for a nonexistent id', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.cancelServiceRequest('user-1', 'nope'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_FOUND' });
  });

  it("throws SERVICE_REQUEST_NOT_FOUND (same code) for another customer's ServiceRequest", async () => {
    const { service } = makeService({
      existing: makeExisting({ customerProfileId: 'someone-elses-profile' }),
    });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_FOUND' });
  });

  it('throws SERVICE_REQUEST_ALREADY_CANCELLED when cancelling twice', async () => {
    const { service } = makeService({
      existing: makeExisting({ status: ServiceRequestStatus.CANCELLED }),
    });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_ALREADY_CANCELLED' });
  });

  it('throws SERVICE_REQUEST_HAS_ENGAGEMENT when cancelling an ENGAGED ServiceRequest', async () => {
    const { service, cancel } = makeService({
      existing: makeExisting({ status: ServiceRequestStatus.ENGAGED }),
    });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_HAS_ENGAGEMENT' });
    // Never even attempts the write once the pre-read already shows ENGAGED.
    expect(cancel).not.toHaveBeenCalled();
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('re-reads and throws SERVICE_REQUEST_HAS_ENGAGEMENT when the CAS loses a race against a concurrent acceptQuote', async () => {
    const { service, cancel } = makeService({
      cancelCount: 0,
      reReadExisting: makeExisting({ status: ServiceRequestStatus.ENGAGED }),
    });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_HAS_ENGAGEMENT' });
    expect(cancel).toHaveBeenCalledWith('service-request-1');
  });

  it('re-reads and throws SERVICE_REQUEST_ALREADY_CANCELLED when the CAS loses a race against a concurrent cancelServiceRequest', async () => {
    const { service } = makeService({
      cancelCount: 0,
      reReadExisting: makeExisting({ status: ServiceRequestStatus.CANCELLED }),
    });

    await expect(
      service.cancelServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_ALREADY_CANCELLED' });
  });
});
