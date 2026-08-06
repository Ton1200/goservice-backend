import { Injectable } from '@nestjs/common';
import { ProfessionalProfile } from '../models/professional-profile.model';
import { ProfilesRepository } from '../profiles.repository';

/**
 * Thin pass-through — `null` means the caller has not created a
 * `ProfessionalProfile` yet, which is a normal, expected state (not an
 * error).
 */
@Injectable()
export class GetMyProfessionalProfileService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  getMyProfessionalProfile(
    userId: string,
  ): Promise<ProfessionalProfile | null> {
    return this.profilesRepository.findProfessionalProfileByUserId(userId);
  }
}
