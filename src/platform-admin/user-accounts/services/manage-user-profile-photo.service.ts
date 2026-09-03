import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  customerProfileNotFound,
  invalidProfilePhotoUrl,
  professionalProfileNotFound,
  userAccountNotFound,
} from '../errors/user-account.errors';
import { AdminProfileKind } from '../models/admin-profile-kind.enum';
import {
  RemoveUserProfilePhotoInput,
  SetUserProfilePhotoInput,
} from '../models/user-profile-photo.input';
import { UserAccountDetailModel } from '../models/user-account-detail.model';
import { GetUserAccountDetailService } from './get-user-account-detail.service';

/**
 * GOS-70 — orchestrates the admin `setUserProfilePhoto` /
 * `removeUserProfilePhoto` mutations. Sets (or clears) ONLY the target
 * profile's `photoUrl` and writes an `AdminAuditLog` row in the SAME
 * `$transaction` — same pattern as `UpdateUserAccountService`. Returns the
 * refreshed `UserAccountDetailModel` so the panel re-renders without a
 * second round-trip.
 *
 * `setUserProfilePhoto` rejects any `photoUrl` that is not a `publicUrl`
 * this backend's own storage issued (`<baseUrl>/uploads/<key>.webp`) — an
 * admin can only attach a photo that went through the real upload +
 * processing pipeline, never an arbitrary external URL.
 */
@Injectable()
export class ManageUserProfilePhotoService {
  private readonly logger = new Logger(ManageUserProfilePhotoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly getUserAccountDetailService: GetUserAccountDetailService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async setUserProfilePhoto(
    adminUserId: string,
    input: SetUserProfilePhotoInput,
  ): Promise<UserAccountDetailModel> {
    this.assertOwnStorageUrl(input.photoUrl);
    return this.apply(adminUserId, input.userId, input.profileKind, {
      photoUrl: input.photoUrl,
      action: 'USER_PROFILE_PHOTO_SET',
    });
  }

  removeUserProfilePhoto(
    adminUserId: string,
    input: RemoveUserProfilePhotoInput,
  ): Promise<UserAccountDetailModel> {
    return this.apply(adminUserId, input.userId, input.profileKind, {
      photoUrl: null,
      action: 'USER_PROFILE_PHOTO_REMOVED',
    });
  }

  private async apply(
    adminUserId: string,
    userId: string,
    profileKind: AdminProfileKind,
    change: { photoUrl: string | null; action: string },
  ): Promise<UserAccountDetailModel> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw userAccountNotFound(userId);
    }

    const isCustomer = profileKind === AdminProfileKind.CUSTOMER;
    if (isCustomer) {
      const profile =
        await this.profilesRepository.findCustomerProfileByUserId(userId);
      if (!profile) {
        throw customerProfileNotFound(userId);
      }
    } else if (
      !(await this.profilesRepository.professionalProfileExists(userId))
    ) {
      throw professionalProfileNotFound(userId);
    }

    await this.prisma.$transaction(async (tx) => {
      if (isCustomer) {
        await this.profilesRepository.setCustomerProfilePhoto(
          tx,
          userId,
          change.photoUrl,
        );
      } else {
        await this.profilesRepository.setProfessionalProfilePhoto(
          tx,
          userId,
          change.photoUrl,
        );
      }
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: change.action,
        targetType: isCustomer ? 'CustomerProfile' : 'ProfessionalProfile',
        targetKey: userId,
        metadata: { profileKind, hasPhoto: change.photoUrl !== null },
      });
    });

    // Never log the URL itself — same PII discipline as the profiles module.
    this.logger.log({
      event: 'admin_user_profile_photo_changed',
      profileKind,
      hasPhoto: change.photoUrl !== null,
    });

    return this.getUserAccountDetailService.getUserAccountDetail(userId);
  }

  private assertOwnStorageUrl(photoUrl: string): void {
    const baseUrl = this.configService.get('storageLocal', {
      infer: true,
    }).baseUrl;

    let parsed: URL;
    let base: URL;
    try {
      parsed = new URL(photoUrl);
      base = new URL(baseUrl);
    } catch {
      throw invalidProfilePhotoUrl();
    }

    // Origin comparison is tolerant of a trailing slash / extra path on
    // `STORAGE_LOCAL_BASE_URL`; the leading `\/+` in the path regex tolerates
    // the double slash `createUploadUrl` produces when the base URL ends
    // with `/`. The key itself must be exactly what this backend mints:
    // 32 lowercase hex chars + `.webp` (every image content-type normalizes
    // to `.webp`), and no query string.
    const okPath = /^\/+uploads\/[a-f0-9]{32}\.webp$/.test(parsed.pathname);
    if (parsed.origin !== base.origin || !okPath || parsed.search !== '') {
      throw invalidProfilePhotoUrl();
    }
  }
}
