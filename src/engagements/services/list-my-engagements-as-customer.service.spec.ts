import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { ListMyEngagementsAsCustomerService } from './list-my-engagements-as-customer.service';

describe('ListMyEngagementsAsCustomerService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };

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

    const findManyByCustomerProfileId = jest
      .fn()
      .mockResolvedValue([{ id: 'engagement-1' }]);
    const engagementsRepository = {
      findManyByCustomerProfileId,
    } as unknown as EngagementsRepository;

    const service = new ListMyEngagementsAsCustomerService(
      profilesRepository,
      engagementsRepository,
    );

    return { service, findManyByCustomerProfileId };
  }

  it("returns the caller's own Engagements as a Customer", async () => {
    const { service, findManyByCustomerProfileId } = makeService();

    const result = await service.listMyEngagementsAsCustomer('user-1');

    expect(findManyByCustomerProfileId).toHaveBeenCalledWith(
      customerProfile.id,
    );
    expect(result).toHaveLength(1);
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.listMyEngagementsAsCustomer('user-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });
});
