import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { STORAGE_SETTING_KEYS } from '../../storage/storage-setting-keys.constants';
import { invalidProfilePhotoUploadRef } from '../errors/invalid-profile-photo-upload-ref.error';
import { profilePhotoUploadDisabled } from '../errors/profile-photo-upload-disabled.error';
import { CountryCode } from '../models/country-code.enum';
import { ProfessionalProfile } from '../models/professional-profile.model';
import { SpecializationRole } from '../models/specialization-role.enum';
import { UpsertProfessionalProfileInput } from '../models/upsert-professional-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';

const DEFAULT_COUNTRY = CountryCode.AR;

/**
 * Orchestrates `upsertProfessionalProfile` (GOS-14/GOS-28, restructured to
 * per-specialization data in a follow-up pass) — always idempotent (never
 * creates a duplicate row per user, physically enforced by
 * `ProfessionalProfile.userId`'s `@unique`); `verificationStatus` is
 * always `UNVERIFIED` on creation and never mutated here — no code path in
 * this service can set anything else (see `ProfilesRepository`'s
 * `upsertProfessionalProfile`). On the very first successful creation only,
 * transitions the owning `User.accountStatus` from `EMAIL_VERIFIED` to
 * `PENDING_APPROVAL` — that transition itself is implemented atomically
 * inside `ProfilesRepository.upsertProfessionalProfile` — this service
 * only decides what to log based on the repository's result, it never
 * re-derives or re-checks the transition itself.
 *
 * Two things the DTO layer can't check on its own, so this service does:
 * every submitted `categoryId` must actually exist
 * (`CATEGORY_NOT_FOUND`), and exactly one specialization must carry
 * `role: PRIMARY` (`PRIMARY_SPECIALIZATION_REQUIRED`) — a professional's
 * main trade must always be identifiable, but the DTO layer has no way to
 * count across array items.
 *
 * Never logs `firstName`/`lastName`/`displayName`/`city`/`country`/
 * `serviceAreaDescription`/`bio`/`photoUrl`/`languages`/any specialization
 * `description` — only IDs, booleans, counts, and status/role values.
 *
 * `locationSharingEnabled` (GOS-62) is passed through exactly like
 * `photoUrl`/`languages` below — `undefined` when omitted, never coerced —
 * so an edit that doesn't mention it leaves the previously persisted value
 * untouched. See `UpsertCustomerProfileService`'s own comment on this same
 * field for the full rationale (independent per profile — a User with both
 * a CustomerProfile and a ProfessionalProfile may set each differently).
 */
@Injectable()
export class UpsertProfessionalProfileService {
  private readonly logger = new Logger(UpsertProfessionalProfileService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async upsertProfessionalProfile(
    userId: string,
    input: UpsertProfessionalProfileInput,
  ): Promise<ProfessionalProfile> {
    this.assertExactlyOnePrimary(input.specializations);
    await this.assertCategoriesExist(
      input.specializations.map((s) => s.categoryId),
    );

    const { photoUrl, photoUploadRefId } = await this.resolvePhotoUploadRef(
      userId,
      input.photoUploadRef,
    );

    const { profile, wasCreated, accountStatusTransitioned } =
      await this.profilesRepository.upsertProfessionalProfile(userId, {
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        city: input.city,
        country: input.country ?? DEFAULT_COUNTRY,
        serviceAreaDescription: input.serviceAreaDescription,
        bio: input.bio,
        photoUrl,
        photoUploadRefId,
        languages: input.languages,
        specializations: input.specializations,
        locationSharingEnabled: input.locationSharingEnabled,
      });

    this.logger.log({
      event: 'profile_upserted',
      profileType: 'PROFESSIONAL',
      wasCreated,
      photoUploadRefUsed: photoUploadRefId != null,
    });
    this.logger.log({
      event: wasCreated
        ? 'professional_profile_created'
        : 'professional_profile_updated',
      specializationCount: profile.specializations.length,
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
   * GOS-70 — see `UpsertCustomerProfileService.resolvePhotoUploadRef` for
   * the rationale; identical behaviour for the professional profile.
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

  private assertExactlyOnePrimary(
    specializations: UpsertProfessionalProfileInput['specializations'],
  ): void {
    const primaryCount = specializations.filter(
      (s) => s.role === SpecializationRole.PRIMARY,
    ).length;

    if (primaryCount !== 1) {
      throw new DomainException(
        'PRIMARY_SPECIALIZATION_REQUIRED',
        'Exactly one specialization must have role PRIMARY.',
      );
    }
  }

  private async assertCategoriesExist(categoryIds: string[]): Promise<void> {
    const existingIds =
      await this.profilesRepository.findExistingCategoryIds(categoryIds);
    const existingIdSet = new Set(existingIds);
    const missingIds = categoryIds.filter((id) => !existingIdSet.has(id));

    if (missingIds.length > 0) {
      throw new DomainException(
        'CATEGORY_NOT_FOUND',
        `The following category IDs do not exist: ${missingIds.join(', ')}.`,
      );
    }
  }
}
