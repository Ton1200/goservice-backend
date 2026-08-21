import { Injectable } from '@nestjs/common';
import { Engagement } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { EngagementsRepository } from '../engagements.repository';

/**
 * Orchestrates `Query.myEngagementsAsCustomer` — always "the caller's own
 * Engagements as a Customer", derived from `@CurrentUser()`, no arguments.
 */
@Injectable()
export class ListMyEngagementsAsCustomerService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async listMyEngagementsAsCustomer(userId: string): Promise<Engagement[]> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    return this.engagementsRepository.findManyByCustomerProfileId(
      customerProfile.id,
    );
  }
}
