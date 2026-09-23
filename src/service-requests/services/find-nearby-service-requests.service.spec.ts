import { AddressesRepository } from '../../addresses/addresses.repository';
import {
  MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY,
  MAPS_SEARCH_MAX_RADIUS_KM_KEY,
} from '../../addresses/constants/maps-setting-keys.constants';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { FindNearbyServiceRequestsService } from './find-nearby-service-requests.service';

describe('FindNearbyServiceRequestsService', () => {
  const professionalProfile = {
    id: 'professional-1',
    specializations: [{ category: { id: 'cat-1' } }],
  };
  const match = {
    serviceRequestId: 'sr-1',
    addressId: 'address-1',
    distanceKm: 4.1,
  };
  const serviceRequest = { id: 'sr-1', description: 'Reparar cañería' };
  const address = { id: 'address-1', formattedAddress: 'Av. Siempre Viva 123' };

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    descendantCategoryIds?: string[];
    matches?: (typeof match)[];
    serviceRequests?: (typeof serviceRequest)[];
    addresses?: (typeof address)[];
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? professionalProfile
          : overrides.professionalProfile,
      );
    const findDescendantCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.descendantCategoryIds ?? ['cat-1']);
    const profilesRepository = {
      findProfessionalProfileByUserId,
      findDescendantCategoryIds,
    } as unknown as ProfilesRepository;

    const findNearbyCompatible = jest
      .fn()
      .mockResolvedValue(overrides?.matches ?? [match]);
    const findManyByIds = jest
      .fn()
      .mockResolvedValue(overrides?.serviceRequests ?? [serviceRequest]);
    const serviceRequestsRepository = {
      findNearbyCompatible,
      findManyByIds,
    } as unknown as ServiceRequestsRepository;

    const findManyAddressesByIds = jest
      .fn()
      .mockResolvedValue(overrides?.addresses ?? [address]);
    const addressesRepository = {
      findManyByIds: findManyAddressesByIds,
    } as unknown as AddressesRepository;

    const platformSettingPort = {
      isEnabled: jest.fn(),
      getValue: jest.fn((key: string) => {
        if (key === MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY)
          return Promise.resolve('15');
        if (key === MAPS_SEARCH_MAX_RADIUS_KM_KEY) return Promise.resolve('50');
        return Promise.resolve(null);
      }),
    } as unknown as PlatformSettingPort;

    const service = new FindNearbyServiceRequestsService(
      profilesRepository,
      serviceRequestsRepository,
      addressesRepository,
      platformSettingPort,
    );

    return {
      service,
      findProfessionalProfileByUserId,
      findDescendantCategoryIds,
      findNearbyCompatible,
      findManyByIds,
      findManyAddressesByIds,
    };
  }

  it('returns the serviceRequest + address + distance for each match', async () => {
    const { service } = makeService();

    const results = await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([{ serviceRequest, address, distanceKm: 4.1 }]);
  });

  it('returns an empty array when the caller has no ProfessionalProfile', async () => {
    const { service, findNearbyCompatible } = makeService({
      professionalProfile: null,
    });

    const results = await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
    expect(findNearbyCompatible).not.toHaveBeenCalled();
  });

  it('returns an empty array when the ProfessionalProfile has no specializations', async () => {
    const { service, findNearbyCompatible } = makeService({
      professionalProfile: { id: 'professional-1', specializations: [] },
    });

    const results = await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
    expect(findNearbyCompatible).not.toHaveBeenCalled();
  });

  it('resolves categoryIds via findDescendantCategoryIds using the specialized category ids', async () => {
    const { service, findDescendantCategoryIds, findNearbyCompatible } =
      makeService({ descendantCategoryIds: ['cat-1', 'cat-1-child'] });

    await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(findDescendantCategoryIds).toHaveBeenCalledWith(['cat-1']);
    expect(findNearbyCompatible).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-1', 'cat-1-child'] }),
    );
  });

  it('returns an empty array without hydrating anything when there are no matches', async () => {
    const { service, findManyByIds, findManyAddressesByIds } = makeService({
      matches: [],
    });

    const results = await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
    expect(findManyByIds).not.toHaveBeenCalled();
    expect(findManyAddressesByIds).not.toHaveBeenCalled();
  });

  it('skips a match whose ServiceRequest or Address vanished concurrently', async () => {
    const { service } = makeService({ serviceRequests: [] });

    const results = await service.findNearbyServiceRequests('user-1', {
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
  });
});
