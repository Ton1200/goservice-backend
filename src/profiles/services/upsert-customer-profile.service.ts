import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { STORAGE_SETTING_KEYS } from '../../storage/storage-setting-keys.constants';
import { invalidProfilePhotoUploadRef } from '../errors/invalid-profile-photo-upload-ref.error';
import { profilePhotoUploadDisabled } from '../errors/profile-photo-upload-disabled.error';
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
 * `locationSharingEnabled` (GOS-62) is passed through — `undefined` when
 * omitted, never coerced to `false` — so an edit that doesn't mention it
 * leaves the previously persisted value untouched (Prisma drops `undefined`
 * fields from its update payload; see
 * `ProfilesRepository.upsertCustomerProfile`). Unlike `country`, it does
 * NOT get a `?? DEFAULT` fallback here.
 *
 * `photoUploadRef` (GOS-70) is the ONLY way to set the profile photo. When
 * present: the profile-photo feature must be enabled
 * (`PROFILE_PHOTO_UPLOAD_DISABLED` otherwise), the ref must resolve to a
 * usable `ProfilePhotoUploadRef` for this user
 * (`INVALID_PROFILE_PHOTO_UPLOAD_REF` otherwise), and its `fileUrl`
 * becomes `photoUrl` while the ref is marked `CONSUMED` in the same
 * transaction as the profile write. Omitted => the persisted photo is left
 * unchanged.
 */
@Injectable()
export class UpsertCustomerProfileService {
  private readonly logger = new Logger(UpsertCustomerProfileService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async upsertCustomerProfile(
    userId: string,
    input: UpsertCustomerProfileInput,
  ): Promise<CustomerProfile> {
    const { photoUrl, photoUploadRefId } = await this.resolvePhotoUploadRef(
      userId,
      input.photoUploadRef,
    );

    const { profile, wasCreated, accountStatusTransitioned } =
      await this.profilesRepository.upsertCustomerProfile(userId, {
        firstName: input.firstName,
        lastName: input.lastName,
        addressLine: input.addressLine,
        city: input.city,
        province: input.province,
        country: input.country ?? DEFAULT_COUNTRY,
        photoUrl,
        photoUploadRefId,
        locationSharingEnabled: input.locationSharingEnabled,
      });

    this.logger.log({
      event: 'profile_upserted',
      profileType: 'CUSTOMER',
      wasCreated,
      photoUploadRefUsed: photoUploadRefId != null,
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

  /**
   * GOS-70 — resolves a submitted `photoUploadRef` to the concrete
   * `photoUrl` (the processed WebP URL) + the ref id the repository will
   * mark `CONSUMED` inside its transaction. Read (not the consume) happens
   * here, outside the tx — same accepted small TOCTOU window as
   * `PublishServiceRequestService.resolveAttachmentRefs`; the repo's
   * `status: PENDING` guard makes a double-spend a no-op.
   *
   * Returns `{ photoUrl: undefined, photoUploadRefId: undefined }` when no
   * ref was submitted — Prisma then drops the `undefined` `photoUrl`, so an
   * edit that omits it leaves the persisted photo unchanged.
   */
  private async resolvePhotoUploadRef(
    userId: string,
    photoUploadRef: string | undefined,
  ): Promise<{ photoUrl?: string; photoUploadRefId?: string }> {
    if (photoUploadRef == null) {
      return {};
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        STORAGE_SETTING_KEYS.profilePhotoUploadEnabled,
      ))
    ) {
      throw profilePhotoUploadDisabled();
    }
    const ref = await this.profilesRepository.findUsablePendingPhotoUploadRef(
      userId,
      photoUploadRef,
    );
    if (!ref) {
      throw invalidProfilePhotoUploadRef();
    }
    return { photoUrl: ref.fileUrl, photoUploadRefId: ref.id };
  }
}
