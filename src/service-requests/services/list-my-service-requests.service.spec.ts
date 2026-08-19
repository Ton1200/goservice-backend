import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { ListMyServiceRequestsService } from './list-my-service-requests.service';

describe('ListMyServiceRequestsService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };
  const rows = [
    { id: 'service-request-1', customerProfileId: customerProfile.id },
  ];

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
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

    const findManyByCustomerProfileId = jest.fn().mockResolvedValue(rows);
    const serviceRequestsRepository = {
      findManyByCustomerProfileId,
    } as unknown as ServiceRequestsRepository;

    const service = new ListMyServiceRequestsService(
      profilesRepository,
      serviceRequestsRepository,
    );

    return { service, findManyByCustomerProfileId };
  }

  it("returns the caller's own ServiceRequests", async () => {
    const { service, findManyByCustomerProfileId } = makeService();

    const result = await service.listMyServiceRequests('user-1');

    expect(findManyByCustomerProfileId).toHaveBeenCalledWith(
      customerProfile.id,
    );
    expect(result).toBe(rows);
  });

  it('returns an empty list (no error) when the caller has no CustomerProfile', async () => {
    const { service, findManyByCustomerProfileId } = makeService({
      customerProfile: null,
    });

    const result = await service.listMyServiceRequests('user-1');

    expect(result).toEqual([]);
    expect(findManyByCustomerProfileId).not.toHaveBeenCalled();
  });
});
