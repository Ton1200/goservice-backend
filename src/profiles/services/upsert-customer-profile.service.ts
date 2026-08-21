import { Injectable, Logger } from '@nestjs/common';
import { CountryCode } from '../models/country-code.enum';
import { CustomerProfile } from '../models/customer-profile.model';
import { UpsertCustomerProfileInput } from '../models/upsert-customer-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';

const DEFAULT_COUNTRY = CountryCode.AR;

/**
 * Orchestrates `upsertCustomerProfile` (GOS-14/GOS-28) — always idempotent
 * (never creates a duplicate row per user, physically enforced by
 * `CustomerProfile.userId`'s `@unique`) and, on the very first successful
 * creation only, transitions the owning `User.accountStatus` from
 * `EMAIL_VERIFIED` to `PENDING_APPROVAL`. That transition itself is
 * implemented atomically inside `ProfilesRepository.upsertCustomerProfile`
 * — this service only decides what to log based on the repository's
 * result, it never re-derives or re-checks the transition itself.
 *
 * Never logs `displayName`/`addressLine`/`city`/`province`/`country`/
 * `photoUrl` — only IDs, booleans, and status values.
 */
@Injectable()
export class UpsertCustomerProfileService {
  private readonly logger = new Logger(UpsertCustomerProfileService.name);

  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async upsertCustomerProfile(
    userId: string,
    input: UpsertCustomerProfileInput,
  ): Promise<CustomerProfile> {
    const { profile, wasCreated, accountStatusTransitioned } =
      await this.profilesRepository.upsertCustomerProfile(userId, {
        displayName: input.displayName,
        addressLine: input.addressLine,
        city: input.city,
        province: input.province,
        country: input.country ?? DEFAULT_COUNTRY,
        photoUrl: input.photoUrl,
      });

    this.logger.log({
      event: 'profile_upserted',
      profileType: 'CUSTOMER',
      wasCreated,
    });
    this.logger.log({
      event: wasCreated
        ? 'customer_profile_created'
        : 'customer_profile_updated',
    });
    if (accountStatusTransitioned) {
      this.logger.log({
        event: 'account_status_transition',
        from: 'EMAIL_VERIFIED',
        to: 'PENDING_APPROVAL',
      });
    }

    return profile;
  }
}
