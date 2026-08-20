import { Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { snapToGrid } from '../../geo/utils/snap-to-grid.util';
import { CountryCode } from '../models/country-code.enum';
import { ProfessionalProfile } from '../models/professional-profile.model';
import { ServiceAreaInput } from '../models/service-area-input.model';
import { SpecializationRole } from '../models/specialization-role.enum';
import { UpsertProfessionalProfileInput } from '../models/upsert-professional-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';

type ServiceAreaColumns = {
  serviceAreaLatitude: number;
  serviceAreaLongitude: number;
  serviceAreaRadiusKm: number;
  approximateLatitude: number;
  approximateLongitude: number;
};

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
 * Never logs `displayName`/`city`/`country`/`serviceAreaDescription`/`bio`/
 * `photoUrl`/`languages`/any specialization `description` — only IDs,
 * booleans, counts, and status/role values.
 *
 * Also derives the public approximate Service Area pair via `snapToGrid` before persisting (ADR 0006).
 */
@Injectable()
export class UpsertProfessionalProfileService {
  private readonly logger = new Logger(UpsertProfessionalProfileService.name);

  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async upsertProfessionalProfile(
    userId: string,
    input: UpsertProfessionalProfileInput,
  ): Promise<ProfessionalProfile> {
    this.assertExactlyOnePrimary(input.specializations);
    await this.assertCategoriesExist(
      input.specializations.map((s) => s.categoryId),
    );

    const { profile, wasCreated, accountStatusTransitioned } =
      await this.profilesRepository.upsertProfessionalProfile(userId, {
        displayName: input.displayName,
        city: input.city,
        country: input.country ?? DEFAULT_COUNTRY,
        serviceAreaDescription: input.serviceAreaDescription,
        bio: input.bio,
        photoUrl: input.photoUrl,
        languages: input.languages,
        specializations: input.specializations,
        serviceArea: this.deriveServiceAreaColumns(input.serviceArea),
      });

    this.logger.log({
      event: 'profile_upserted',
      profileType: 'PROFESSIONAL',
      wasCreated,
    });
    this.logger.log({
      event: wasCreated
        ? 'professional_profile_created'
        : 'professional_profile_updated',
      specializationCount: profile.specializations.length,
      serviceAreaSet: input.serviceArea !== undefined,
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

  /** `undefined` in, `undefined` out — an omitted `serviceArea` never reaches a snap computation. */
  private deriveServiceAreaColumns(
    serviceArea: ServiceAreaInput | undefined,
  ): ServiceAreaColumns | undefined {
    if (!serviceArea) {
      return undefined;
    }

    const approximate = snapToGrid({
      latitude: serviceArea.latitude,
      longitude: serviceArea.longitude,
    });

    return {
      serviceAreaLatitude: serviceArea.latitude,
      serviceAreaLongitude: serviceArea.longitude,
      serviceAreaRadiusKm: serviceArea.radiusKm,
      approximateLatitude: approximate.latitude,
      approximateLongitude: approximate.longitude,
    };
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
