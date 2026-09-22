import { AddressesRepository } from '../../addresses/addresses.repository';
import {
  MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY,
  MAPS_SEARCH_MAX_RADIUS_KM_KEY,
} from '../../addresses/constants/maps-setting-keys.constants';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ProfilesRepository } from '../profiles.repository';
import { FindNearbyProfessionalsService } from './find-nearby-professionals.service';

describe('FindNearbyProfessionalsService', () => {
  const match = {
    professionalProfileId: 'professional-1',
    addressId: 'address-1',
    distanceKm: 3.2,
  };
  const professionalProfile = { id: 'professional-1', firstName: 'Ana' };
  const address = { id: 'address-1', formattedAddress: 'Av. Siempre Viva 123' };

  function makeService(overrides?: {
    existingCategoryIds?: string[];
    ancestorCategoryIds?: string[];
    matches?: (typeof match)[];
    professionalProfiles?: (typeof professionalProfile)[];
    addresses?: (typeof address)[];
  }) {
    const findExistingCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.existingCategoryIds ?? ['cat-1']);
    const findAncestorCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.ancestorCategoryIds ?? ['cat-1']);
    const findNearbyProfessionals = jest
      .fn()
      .mockResolvedValue(overrides?.matches ?? [match]);
    const findManyProfessionalProfilesByIds = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfiles ?? [professionalProfile],
      );
    const profilesRepository = {
      findExistingCategoryIds,
      findAncestorCategoryIds,
      findNearbyProfessionals,
      findManyProfessionalProfilesByIds,
    } as unknown as ProfilesRepository;

    const findManyByIds = jest
      .fn()
      .mockResolvedValue(overrides?.addresses ?? [address]);
    const addressesRepository = {
      findManyByIds,
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

    const service = new FindNearbyProfessionalsService(
      profilesRepository,
      addressesRepository,
      platformSettingPort,
    );

    return {
      service,
      findExistingCategoryIds,
      findAncestorCategoryIds,
      findNearbyProfessionals,
      findManyProfessionalProfilesByIds,
      findManyByIds,
    };
  }

  it('returns the professional + address + distance for each match, nearest first as given by the repository', async () => {
    const { service } = makeService();

    const results = await service.findNearbyProfessionals({
      categoryId: 'cat-1',
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([
      { professional: professionalProfile, address, distanceKm: 3.2 },
    ]);
  });

  it('resolves categoryIds via findAncestorCategoryIds (hierarchical matching — a Professional specialized in an ANCESTOR category still matches)', async () => {
    const { service, findAncestorCategoryIds, findNearbyProfessionals } =
      makeService({ ancestorCategoryIds: ['cat-1-child', 'cat-1'] });

    await service.findNearbyProfessionals({
      categoryId: 'cat-1-child',
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(findAncestorCategoryIds).toHaveBeenCalledWith('cat-1-child');
    expect(findNearbyProfessionals).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-1-child', 'cat-1'] }),
    );
  });

  it('throws CATEGORY_NOT_FOUND when categoryId does not exist', async () => {
    const { service } = makeService({ existingCategoryIds: [] });

    await expect(
      service.findNearbyProfessionals({
        categoryId: 'nonexistent',
        latitude: -34.6,
        longitude: -58.4,
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('returns an empty array without hydrating anything when there are no matches', async () => {
    const { service, findManyProfessionalProfilesByIds, findManyByIds } =
      makeService({ matches: [] });

    const results = await service.findNearbyProfessionals({
      categoryId: 'cat-1',
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
    expect(findManyProfessionalProfilesByIds).not.toHaveBeenCalled();
    expect(findManyByIds).not.toHaveBeenCalled();
  });

  it('skips a match whose professional profile or Address vanished concurrently', async () => {
    const { service } = makeService({
      professionalProfiles: [],
    });

    const results = await service.findNearbyProfessionals({
      categoryId: 'cat-1',
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(results).toEqual([]);
  });

  it('passes the caller-supplied radiusKm through to resolveEffectiveSearchRadiusKm/the repository query', async () => {
    const { service, findNearbyProfessionals } = makeService();

    await service.findNearbyProfessionals({
      categoryId: 'cat-1',
      latitude: -34.6,
      longitude: -58.4,
      radiusKm: 5,
    });

    expect(findNearbyProfessionals).toHaveBeenCalledWith(
      expect.objectContaining({ radiusKm: 5 }),
    );
  });

  it('"ver todos" mode: when categoryId is omitted, skips category resolution entirely and passes categoryIds: null to the repository', async () => {
    const {
      service,
      findExistingCategoryIds,
      findAncestorCategoryIds,
      findNearbyProfessionals,
    } = makeService();

    const results = await service.findNearbyProfessionals({
      latitude: -34.6,
      longitude: -58.4,
    });

    expect(findExistingCategoryIds).not.toHaveBeenCalled();
    expect(findAncestorCategoryIds).not.toHaveBeenCalled();
    expect(findNearbyProfessionals).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: null }),
    );
    expect(results).toEqual([
      { professional: professionalProfile, address, distanceKm: 3.2 },
    ]);
  });
});
