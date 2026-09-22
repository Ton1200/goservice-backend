import { Injectable } from '@nestjs/common';
import { AddressesRepository } from '../../addresses/addresses.repository';
import { computeSearchBoundingBox } from '../../addresses/utils/compute-search-bounding-box.util';
import { resolveEffectiveSearchRadiusKm } from '../../addresses/services/resolve-effective-search-radius.util';
import { DomainException } from '../../common/errors/domain-exception';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { NearbyProfessional } from '../models/nearby-professional.model';
import { ProfilesRepository } from '../profiles.repository';

/**
 * Orchestrates `Query.nearbyProfessionals` — read-only. Returns
 * Professionals who (a) — when the caller supplied a `categoryId` — offer
 * it or one of its ANCESTOR Categories (hierarchical matching — see
 * `ProfilesRepository.findAncestorCategoryIds`'s own header comment for why
 * this is the OPPOSITE traversal direction from
 * `ListCompatibleServiceRequestsService`'s `findDescendantCategoryIds`), or
 * — when `categoryId` is omitted — offer ANY specialization at all ("ver
 * todos" mode, confirmed after GOS-155's initial delivery: a Customer can
 * browse every nearby Professional first and filter by category
 * afterwards, instead of being forced to pick one up front); (b) have
 * opted into `locationSharingEnabled`; and (c) have a saved `isDefault`
 * Address currently within the resolved search radius of `(latitude,
 * longitude)` — nearest first.
 *
 * A Professional with zero saved Addresses can never appear here, even with
 * `locationSharingEnabled: true` (confirmed decision — GOS-155's own
 * closed scope: the pin origin is always a saved, `isDefault` Address,
 * never a live client-reported coordinate). Likewise, a Professional with
 * zero specializations never appears, even in unfiltered "ver todos" mode —
 * they aren't offering any service yet.
 */
@Injectable()
export class FindNearbyProfessionalsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly addressesRepository: AddressesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async findNearbyProfessionals(params: {
    categoryId?: string;
    latitude: number;
    longitude: number;
    radiusKm?: number;
  }): Promise<NearbyProfessional[]> {
    let categoryIds: string[] | null = null;
    if (params.categoryId !== undefined) {
      const existingCategoryIds =
        await this.profilesRepository.findExistingCategoryIds([
          params.categoryId,
        ]);
      if (existingCategoryIds.length === 0) {
        throw new DomainException(
          'CATEGORY_NOT_FOUND',
          `The following category IDs do not exist: ${params.categoryId}.`,
        );
      }
      categoryIds = await this.profilesRepository.findAncestorCategoryIds(
        params.categoryId,
      );
    }

    const radiusKm = await resolveEffectiveSearchRadiusKm(
      this.platformSettingPort,
      params.radiusKm,
    );
    const boundingBox = computeSearchBoundingBox(
      params.latitude,
      params.longitude,
      radiusKm,
    );

    const matches = await this.profilesRepository.findNearbyProfessionals({
      categoryIds,
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm,
      boundingBox,
    });
    if (matches.length === 0) {
      return [];
    }

    const [professionalProfiles, addresses] = await Promise.all([
      this.profilesRepository.findManyProfessionalProfilesByIds(
        matches.map((match) => match.professionalProfileId),
      ),
      this.addressesRepository.findManyByIds(
        matches.map((match) => match.addressId),
      ),
    ]);
    const professionalProfileById = new Map(
      professionalProfiles.map((profile) => [profile.id, profile] as const),
    );
    const addressById = new Map(
      addresses.map((address) => [address.id, address] as const),
    );

    // Preserves the raw-SQL query's own nearest-first order. A match whose
    // profile/Address vanished between the two reads (a genuine concurrent
    // delete) is defensively skipped rather than surfaced as a broken row.
    const results: NearbyProfessional[] = [];
    for (const match of matches) {
      const professional = professionalProfileById.get(
        match.professionalProfileId,
      );
      const address = addressById.get(match.addressId);
      if (!professional || !address) {
        continue;
      }
      results.push({ professional, address, distanceKm: match.distanceKm });
    }
    return results;
  }
}
