import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestModel } from '../models/service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Query.compatibleServiceRequests` — read-only. Returns only
 * `OPEN` `ServiceRequest`s whose `Category` is one the authenticated
 * Professional actually offers (via `ProfessionalProfile.specializations`
 * — NOT a single category field, see `ProfilesRepository.
 * findProfessionalProfileByUserId`). Always derived from `@CurrentUser()` —
 * this query takes no `professionalProfileId` argument, so a Professional
 * can never query another Professional's compatible list.
 *
 * HIERARCHICAL MATCHING (category-tree follow-up, 2026-08-18) — a
 * Professional specialized in a PARENT Category is treated as compatible
 * with every Category nested under it too, not only the exact id they
 * specialized in (via `ProfilesRepository.findDescendantCategoryIds`,
 * which returns each given id UNION all of its descendants). This is
 * ONE-DIRECTIONAL, confirmed and scoped explicitly: the REVERSE is NOT
 * implemented — specializing in a CHILD Category does NOT make a
 * Professional compatible with its ANCESTORS' (or siblings') own
 * ServiceRequests. Example: a Professional specialized in "Electricidad"
 * (root) sees OPEN ServiceRequests under "Electricidad" AND under any of
 * its children (e.g. "Instalaciones"); a Professional specialized ONLY in
 * "Instalaciones" does NOT see plain "Electricidad"-categorized requests.
 */
@Injectable()
export class ListCompatibleServiceRequestsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async listCompatibleServiceRequests(
    userId: string,
  ): Promise<ServiceRequestModel[]> {
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

    return this.serviceRequestsRepository.findManyCompatible(categoryIds);
  }
}
