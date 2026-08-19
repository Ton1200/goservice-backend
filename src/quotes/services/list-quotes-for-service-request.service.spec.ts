import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { QuotesRepository } from '../quotes.repository';
import { ListQuotesForServiceRequestService } from './list-quotes-for-service-request.service';

describe('ListQuotesForServiceRequestService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };

  function makeServiceRequest(
    overrides?: Partial<{ customerProfileId: string }>,
  ) {
    return {
      id: 'service-request-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    serviceRequest?: ReturnType<typeof makeServiceRequest> | null;
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

    const serviceRequest =
      overrides?.serviceRequest === undefined
        ? makeServiceRequest()
        : overrides.serviceRequest;
    const findById = jest.fn().mockResolvedValue(serviceRequest);
    const serviceRequestsRepository = {
      findById,
    } as unknown as ServiceRequestsRepository;

    const findManyByServiceRequestId = jest
      .fn()
      .mockResolvedValue([{ id: 'quote-1' }]);
    const quotesRepository = {
      findManyByServiceRequestId,
    } as unknown as QuotesRepository;

    const service = new ListQuotesForServiceRequestService(
      profilesRepository,
      serviceRequestsRepository,
      quotesRepository,
    );

    return { service, findManyByServiceRequestId };
  }

  it("returns Quotes for the caller's own ServiceRequest", async () => {
    const { service, findManyByServiceRequestId } = makeService();

    const result = await service.listQuotesForServiceRequest(
      'user-1',
      'service-request-1',
    );

    expect(findManyByServiceRequestId).toHaveBeenCalledWith(
      'service-request-1',
    );
    expect(result).toHaveLength(1);
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.listQuotesForServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('throws SERVICE_REQUEST_NOT_FOUND for a nonexistent ServiceRequest', async () => {
    const { service } = makeService({ serviceRequest: null });

    await expect(
      service.listQuotesForServiceRequest('user-1', 'nope'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_FOUND' });
  });

  it("throws SERVICE_REQUEST_NOT_FOUND (same code) for another customer's ServiceRequest", async () => {
    const { service } = makeService({
      serviceRequest: makeServiceRequest({
        customerProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.listQuotesForServiceRequest('user-1', 'service-request-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_FOUND' });
  });
});
