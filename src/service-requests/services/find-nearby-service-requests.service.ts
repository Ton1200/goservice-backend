import { Injectable } from '@nestjs/common';
import { AddressesRepository } from '../../addresses/addresses.repository';
import { resolveEffectiveSearchRadiusKm } from '../../addresses/services/resolve-effective-search-radius.util';
import { computeSearchBoundingBox } from '../../addresses/utils/compute-search-bounding-box.util';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { NearbyServiceRequest } from '../models/nearby-service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Query.nearbyServiceRequests` — read-only. Returns OPEN
 * `ServiceRequest`s that (a) match one of the authenticated Professional's
 * own specializations, following the exact SAME hierarchical-matching rule
 * `ListCompatibleServiceRequestsService` already establishes, (b) were
 * published with a resolved `addressId`, (c) belong to a Customer who has
 * opted into `locationSharingEnabled`, and (d) currently fall within the
 * resolved search radius of `(latitude, longitude)` — nearest first.
 *
 * Always derived from `@CurrentUser()` — this query takes no
 * `professionalProfileId` argument, same convention
 * `compatibleServiceRequests` already establishes.
 */
@Injectable()
export class FindNearbyServiceRequestsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly addressesRepository: AddressesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async findNearbyServiceRequests(
    userId: string,
    params: { latitude: number; longitude: number; radiusKm?: number },
  ): Promise<NearbyServiceRequest[]> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (
      !professionalProfile ||
      professionalProfile.specializations.length === 0
    ) {
      return [];
    }

    const specializedCategoryIds = [
      ...new Set(
        professionalProfile.specializations.map(
          (specialization) => specialization.category.id,
        ),
      ),
    ];
    const categoryIds = await this.profilesRepository.findDescendantCategoryIds(
      specializedCategoryIds,
    );
    const radiusKm = await resolveEffectiveSearchRadiusKm(
      this.platformSettingPort,
      params.radiusKm,
    );
    const boundingBox = computeSearchBoundingBox(
      params.latitude,
      params.longitude,
      radiusKm,
    );

    const matches = await this.serviceRequestsRepository.findNearbyCompatible({
      categoryIds,
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm,
      boundingBox,
    });
    if (matches.length === 0) {
      return [];
    }

    const [serviceRequests, addresses] = await Promise.all([
      this.serviceRequestsRepository.findManyByIds(
        matches.map((match) => match.serviceRequestId),
      ),
      this.addressesRepository.findManyByIds(
        matches.map((match) => match.addressId),
      ),
    ]);
    const serviceRequestById = new Map(
      serviceRequests.map(
        (serviceRequest) => [serviceRequest.id, serviceRequest] as const,
      ),
    );
    const addressById = new Map(
      addresses.map((address) => [address.id, address] as const),
    );

    // Preserves the raw-SQL query's own nearest-first order. A match whose
    // ServiceRequest/Address vanished (or its ServiceRequest transitioned
    // away from OPEN) between the two reads is defensively skipped.
    const results: NearbyServiceRequest[] = [];
    for (const match of matches) {
      const serviceRequest = serviceRequestById.get(match.serviceRequestId);
      const address = addressById.get(match.addressId);
      if (!serviceRequest || !address) {
        continue;
      }
      results.push({ serviceRequest, address, distanceKm: match.distanceKm });
    }
    return results;
  }
}
