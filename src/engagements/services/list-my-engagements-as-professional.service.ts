import { Injectable } from '@nestjs/common';
import { Engagement } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { EngagementsRepository } from '../engagements.repository';

/**
 * Orchestrates `Query.myEngagementsAsProfessional` — always "the caller's
 * own Engagements as a Professional", derived from `@CurrentUser()`, no
 * arguments. Reuses `professionalProfileRequired()` from `quotes/errors/`
 * (not duplicated under a new name) — same missing-profile semantics.
 */
@Injectable()
export class ListMyEngagementsAsProfessionalService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async listMyEngagementsAsProfessional(userId: string): Promise<Engagement[]> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    return this.engagementsRepository.findManyByProfessionalProfileId(
      professionalProfile.id,
    );
  }
}
