import { Injectable, Logger } from '@nestjs/common';
import { GeocodingPort } from '../../geo/ports/geocoding.port';
import { Coordinates } from '../../geo/utils/haversine.util';
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
 *
 * Also geocodes the address via `GeocodingPort` on every call (ADR 0006) — soft-fails to `null`, never blocks the write.
 */
@Injectable()
export class UpsertCustomerProfileService {
  private readonly logger = new Logger(UpsertCustomerProfileService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly geocodingPort: GeocodingPort,
  ) {}

  async upsertCustomerProfile(
    userId: string,
    input: UpsertCustomerProfileInput,
  ): Promise<CustomerProfile> {
    const country = input.country ?? DEFAULT_COUNTRY;
    const coordinates = await this.geocodeAddress({
      addressLine: input.addressLine,
      city: input.city,
      province: input.province,
      country,
    });

    const { profile, wasCreated, accountStatusTransitioned } =
      await this.profilesRepository.upsertCustomerProfile(userId, {
        displayName: input.displayName,
        addressLine: input.addressLine,
        city: input.city,
        province: input.province,
        country,
        photoUrl: input.photoUrl,
        addressLatitude: coordinates?.latitude ?? null,
        addressLongitude: coordinates?.longitude ?? null,
      });

    this.logger.log({
      event: 'profile_upserted',
      profileType: 'CUSTOMER',
      wasCreated,
      geocoded: coordinates !== null,
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

  private async geocodeAddress(address: {
    addressLine: string;
    city: string;
    province: string;
    country: CountryCode;
  }): Promise<Coordinates | null> {
    try {
      return await this.geocodingPort.geocode(
        `${address.addressLine}, ${address.city}, ${address.province}, ${address.country}`,
      );
    } catch (error) {
      this.logger.warn({
        event: 'customer_address_geocoding_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    }
  }
}
