import { Injectable } from '@nestjs/common';
import { BoundingBox } from '../geo/utils/bounding-box.util';
import {
  ProfessionalProfileWithSpecializations,
  ProfilesRepository,
} from '../profiles/profiles.repository';

/** Discovery's data-access seam — delegates to `ProfilesRepository`, since `ProfessionalProfile` is owned by `ProfilesModule`. */
@Injectable()
export class DiscoveryRepository {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  findCandidateProfessionalProfiles(
    box: BoundingBox,
    categoryIds?: string[],
  ): Promise<ProfessionalProfileWithSpecializations[]> {
    return this.profilesRepository.findApproximateProfessionalProfilesInBoundingBox(
      box,
      categoryIds,
    );
  }
}
