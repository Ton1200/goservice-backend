import { Injectable } from '@nestjs/common';
import { CustomerProfile } from '../models/customer-profile.model';
import { ProfilesRepository } from '../profiles.repository';

/**
 * Thin pass-through — `null` means the caller has not created a
 * `CustomerProfile` yet, which is a normal, expected state (not an error).
 */
@Injectable()
export class GetMyCustomerProfileService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  getMyCustomerProfile(userId: string): Promise<CustomerProfile | null> {
    return this.profilesRepository.findCustomerProfileByUserId(userId);
  }
}
