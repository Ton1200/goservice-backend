import { Injectable } from '@nestjs/common';
import { boundingBoxForRadius } from '../../geo/utils/bounding-box.util';
import {
  Coordinates,
  haversineDistanceKm,
} from '../../geo/utils/haversine.util';
import { snapToGrid } from '../../geo/utils/snap-to-grid.util';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { DiscoveryRepository } from '../discovery.repository';
import { locationRequired } from '../errors/location-required.error';
import { NearbyProfessional } from '../models/nearby-professional.model';
import {
  DEFAULT_RESULT_LIMIT,
  DEFAULT_SEARCH_RADIUS_KM,
  NearbyProfessionalsInput,
} from '../models/nearby-professionals-input.model';

/** Rounds a distance in km to 1 decimal place. */
function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Orchestrates `Query.nearbyProfessionals` (ADR 0006 / DEC-005, Proximity Discovery). */
@Injectable()
export class ListNearbyProfessionalsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly discoveryRepository: DiscoveryRepository,
  ) {}

  async listNearbyProfessionals(
    userId: string,
    input: NearbyProfessionalsInput,
  ): Promise<NearbyProfessional[]> {
    const center = await this.resolveCenter(userId, input.center);
    const snappedCenter = snapToGrid(center);

    const radiusKm = input.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM;
    const limit = input.limit ?? DEFAULT_RESULT_LIMIT;

    const categoryIds = input.categoryId
      ? await this.profilesRepository.findDescendantCategoryIds([
          input.categoryId,
        ])
      : undefined;

    const box = boundingBoxForRadius(snappedCenter, radiusKm);
    const candidates =
      await this.discoveryRepository.findCandidateProfessionalProfiles(
        box,
        categoryIds,
      );

    const results: NearbyProfessional[] = [];
    for (const candidate of candidates) {
      if (
        candidate.approximateLatitude === null ||
        candidate.approximateLongitude === null ||
        candidate.serviceAreaRadiusKm === null
      ) {
        continue;
      }

      const distanceKm = haversineDistanceKm(snappedCenter, {
        latitude: candidate.approximateLatitude,
        longitude: candidate.approximateLongitude,
      });

      if (distanceKm > radiusKm || distanceKm > candidate.serviceAreaRadiusKm) {
        continue;
      }

      results.push({
        profile: candidate,
        distanceKm: roundToOneDecimal(distanceKm),
      });
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results.slice(0, limit);
  }

  private async resolveCenter(
    userId: string,
    explicitCenter: Coordinates | undefined,
  ): Promise<Coordinates> {
    if (explicitCenter) {
      return explicitCenter;
    }

    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (
      customerProfile?.addressLatitude != null &&
      customerProfile?.addressLongitude != null
    ) {
      return {
        latitude: customerProfile.addressLatitude,
        longitude: customerProfile.addressLongitude,
      };
    }

    throw locationRequired();
  }
}
