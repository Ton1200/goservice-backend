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
 * Never logs `firstName`/`lastName`/`addressLine`/`city`/`province`/
 * `country`/`photoUrl` — only IDs, booleans, and status values.
 *
 * `locationSharingEnabled` (GOS-62) is passed through exactly like
 * `photoUrl` below — `undefined` when omitted, never coerced to `false` —
 * so an edit that doesn't mention it leaves the previously persisted value
 * untouched (Prisma drops `undefined` fields from its update payload; see
 * `ProfilesRepository.upsertCustomerProfile`). Unlike `country`, it does
 * NOT get a `?? DEFAULT` fallback here — that fallback exists so `create`
 * always has a value, but the schema's own `@default(false)` already
 * covers that case for a boolean, without the update-time footgun a `??`
 * fallback would introduce (it would silently reset the flag on every edit
 * that omits it).
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
        firstName: input.firstName,
        lastName: input.lastName,
        addressLine: input.addressLine,
        city: input.city,
        province: input.province,
        country: input.country ?? DEFAULT_COUNTRY,
        photoUrl: input.photoUrl,
        locationSharingEnabled: input.locationSharingEnabled,
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
