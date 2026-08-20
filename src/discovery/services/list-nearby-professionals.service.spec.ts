import { haversineDistanceKm } from '../../geo/utils/haversine.util';
import { snapToGrid } from '../../geo/utils/snap-to-grid.util';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { DiscoveryRepository } from '../discovery.repository';
import { ListNearbyProfessionalsService } from './list-nearby-professionals.service';

const OBELISCO = { latitude: -34.6037, longitude: -58.3816 };

function makeCandidate(overrides: {
  id: string;
  approximateLatitude: number | null;
  approximateLongitude: number | null;
  serviceAreaRadiusKm: number | null;
}) {
  return {
    id: overrides.id,
    displayName: `Professional ${overrides.id}`,
    specializations: [],
    approximateLatitude: overrides.approximateLatitude,
    approximateLongitude: overrides.approximateLongitude,
    serviceAreaRadiusKm: overrides.serviceAreaRadiusKm,
  };
}

function makeService(overrides?: {
  customerProfile?: {
    addressLatitude: number | null;
    addressLongitude: number | null;
  } | null;
  candidates?: ReturnType<typeof makeCandidate>[];
  descendantCategoryIds?: string[];
}) {
  const findCustomerProfileByUserId = jest
    .fn()
    .mockResolvedValue(overrides?.customerProfile ?? null);
  const findDescendantCategoryIds = jest
    .fn()
    .mockResolvedValue(overrides?.descendantCategoryIds ?? []);
  const profilesRepository = {
    findCustomerProfileByUserId,
    findDescendantCategoryIds,
  } as unknown as ProfilesRepository;

  const findCandidateProfessionalProfiles = jest
    .fn()
    .mockResolvedValue(overrides?.candidates ?? []);
  const discoveryRepository = {
    findCandidateProfessionalProfiles,
  } as unknown as DiscoveryRepository;

  const service = new ListNearbyProfessionalsService(
    profilesRepository,
    discoveryRepository,
  );

  return {
    service,
    findCustomerProfileByUserId,
    findDescendantCategoryIds,
    findCandidateProfessionalProfiles,
  };
}

describe('ListNearbyProfessionalsService', () => {
  it('throws LOCATION_REQUIRED when no explicit center is given and the CustomerProfile has no geocoded address', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.listNearbyProfessionals('user-1', {}),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
  });

  it('throws LOCATION_REQUIRED when the CustomerProfile exists but was never successfully geocoded', async () => {
    const { service } = makeService({
      customerProfile: { addressLatitude: null, addressLongitude: null },
    });

    await expect(
      service.listNearbyProfessionals('user-1', {}),
    ).rejects.toMatchObject({ code: 'LOCATION_REQUIRED' });
  });

  it('falls back to the geocoded CustomerProfile address when no explicit center is given', async () => {
    const {
      service,
      findCustomerProfileByUserId,
      findCandidateProfessionalProfiles,
    } = makeService({
      customerProfile: {
        addressLatitude: OBELISCO.latitude,
        addressLongitude: OBELISCO.longitude,
      },
    });

    await service.listNearbyProfessionals('user-1', {});

    expect(findCustomerProfileByUserId).toHaveBeenCalledWith('user-1');
    expect(findCandidateProfessionalProfiles).toHaveBeenCalled();
  });

  it('uses the explicit center when given, without reading the CustomerProfile', async () => {
    const { service, findCustomerProfileByUserId } = makeService({
      customerProfile: null,
    });

    await service.listNearbyProfessionals('user-1', { center: OBELISCO });

    expect(findCustomerProfileByUserId).not.toHaveBeenCalled();
  });

  it('snaps the center before computing the bounding box (never queries with the raw, exact centre)', async () => {
    const rawCenter = { latitude: -34.60371234, longitude: -58.38161234 };
    const { service, findCandidateProfessionalProfiles } = makeService();

    await service.listNearbyProfessionals('user-1', {
      center: rawCenter,
      radiusKm: 5,
    });

    const [box] = findCandidateProfessionalProfiles.mock.calls[0] as [
      { minLat: number; maxLat: number; minLng: number; maxLng: number },
    ];
    const snapped = snapToGrid(rawCenter);
    const expectedCenterLat = (box.minLat + box.maxLat) / 2;
    expect(expectedCenterLat).toBeCloseTo(snapped.latitude, 8);
  });

  it('expands categoryId to its descendants via ProfilesRepository and passes them to the repository query', async () => {
    const {
      service,
      findDescendantCategoryIds,
      findCandidateProfessionalProfiles,
    } = makeService({ descendantCategoryIds: ['cat-1', 'cat-1-child'] });

    await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      categoryId: 'cat-1',
    });

    expect(findDescendantCategoryIds).toHaveBeenCalledWith(['cat-1']);
    const [, categoryIds] = findCandidateProfessionalProfiles.mock.calls[0] as [
      unknown,
      string[] | undefined,
    ];
    expect(categoryIds).toEqual(['cat-1', 'cat-1-child']);
  });

  it('never calls findDescendantCategoryIds when no categoryId is given', async () => {
    const { service, findDescendantCategoryIds } = makeService();

    await service.listNearbyProfessionals('user-1', { center: OBELISCO });

    expect(findDescendantCategoryIds).not.toHaveBeenCalled();
  });

  it(
    'MANDATORY CASE: a professional within the searcher radius but the searcher OUTSIDE ' +
      "the professional's own declared serviceAreaRadiusKm is EXCLUDED",
    async () => {
      const nearButNotWillingCandidate = makeCandidate({
        id: 'pro-not-willing',
        approximateLatitude: OBELISCO.latitude,
        approximateLongitude: OBELISCO.longitude + 0.02,
        serviceAreaRadiusKm: 1,
      });
      const { service } = makeService({
        candidates: [nearButNotWillingCandidate],
      });

      const results = await service.listNearbyProfessionals('user-1', {
        center: OBELISCO,
        radiusKm: 20,
      });

      expect(results).toHaveLength(0);
    },
  );

  it('includes a candidate within BOTH the searcher radius and their own declared radius', async () => {
    const nearbyCandidate = makeCandidate({
      id: 'pro-nearby',
      approximateLatitude: OBELISCO.latitude,
      approximateLongitude: OBELISCO.longitude + 0.01,
      serviceAreaRadiusKm: 10,
    });
    const { service } = makeService({ candidates: [nearbyCandidate] });

    const results = await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      radiusKm: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0].profile).toBe(nearbyCandidate);
  });

  it('excludes a candidate outside the SEARCHER radius even if their own declared radius is huge', async () => {
    const farCandidate = makeCandidate({
      id: 'pro-far',
      approximateLatitude: -31.4201,
      approximateLongitude: -64.1888,
      serviceAreaRadiusKm: 100,
    });
    const { service } = makeService({ candidates: [farCandidate] });

    const results = await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      radiusKm: 20,
    });

    expect(results).toHaveLength(0);
  });

  it('defensively excludes a candidate with a null approximate pair or null radius, even if the repository query somehow returned one', async () => {
    const brokenCandidate = makeCandidate({
      id: 'pro-broken',
      approximateLatitude: null,
      approximateLongitude: null,
      serviceAreaRadiusKm: null,
    });
    const { service } = makeService({ candidates: [brokenCandidate] });

    const results = await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      radiusKm: 20,
    });

    expect(results).toHaveLength(0);
  });

  it('sorts results by distance ascending and respects limit', async () => {
    const near = makeCandidate({
      id: 'pro-near',
      approximateLatitude: OBELISCO.latitude,
      approximateLongitude: OBELISCO.longitude + 0.003,
      serviceAreaRadiusKm: 30,
    });
    const mid = makeCandidate({
      id: 'pro-mid',
      approximateLatitude: OBELISCO.latitude,
      approximateLongitude: OBELISCO.longitude + 0.02,
      serviceAreaRadiusKm: 30,
    });
    const far = makeCandidate({
      id: 'pro-far',
      approximateLatitude: OBELISCO.latitude,
      approximateLongitude: OBELISCO.longitude + 0.05,
      serviceAreaRadiusKm: 30,
    });
    const { service } = makeService({ candidates: [far, near, mid] });

    const results = await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      radiusKm: 20,
      limit: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0].profile).toBe(near);
    expect(results[1].profile).toBe(mid);
  });

  it('rounds distanceKm to 1 decimal place', async () => {
    const candidate = makeCandidate({
      id: 'pro-1',
      approximateLatitude: OBELISCO.latitude,
      approximateLongitude: OBELISCO.longitude + 0.01,
      serviceAreaRadiusKm: 30,
    });
    const { service } = makeService({ candidates: [candidate] });

    const results = await service.listNearbyProfessionals('user-1', {
      center: OBELISCO,
      radiusKm: 20,
    });

    expect(results).toHaveLength(1);
    const rawDistance = haversineDistanceKm(snapToGrid(OBELISCO), {
      latitude: candidate.approximateLatitude!,
      longitude: candidate.approximateLongitude!,
    });
    expect(results[0].distanceKm).toBeCloseTo(
      Math.round(rawDistance * 10) / 10,
      5,
    );
    expect(Number.isInteger(results[0].distanceKm * 10)).toBe(true);
  });

  it('applies the default radiusKm/limit when omitted', async () => {
    const { service, findCandidateProfessionalProfiles } = makeService();

    await service.listNearbyProfessionals('user-1', { center: OBELISCO });

    expect(findCandidateProfessionalProfiles).toHaveBeenCalled();
  });
});
