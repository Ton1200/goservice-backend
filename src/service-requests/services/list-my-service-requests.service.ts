import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestModel } from '../models/service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Query.myPublishedServiceRequests`. Always "mine" — resolved
 * from `@CurrentUser()`, never a `customerProfileId`/`userId` argument (this
 * query takes no arguments at all).
 */
@Injectable()
export class ListMyServiceRequestsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async listMyServiceRequests(userId: string): Promise<ServiceRequestModel[]> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      // No error — same "return an empty/null result, not a thrown error"
      // convention as `getMyCustomerProfile` when no profile exists yet.
      return [];
    }

    return this.serviceRequestsRepository.findManyByCustomerProfileId(
      customerProfile.id,
    );
  }
}
