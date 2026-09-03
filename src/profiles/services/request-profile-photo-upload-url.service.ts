import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { STORAGE_SETTING_KEYS } from '../../storage/storage-setting-keys.constants';
import { StoragePort } from '../../storage/ports/storage.port';
import { profilePhotoUploadDisabled } from '../errors/profile-photo-upload-disabled.error';
import { unsupportedProfilePhotoContentType } from '../errors/unsupported-profile-photo-content-type.error';
import { DocumentUploadUrlModel } from '../../service-requests/models/document-upload-url.model';
import { RequestProfilePhotoUploadUrlInput } from '../models/request-profile-photo-upload-url-input.model';
import { ProfilesRepository } from '../profiles.repository';

/**
 * Accepted image content-types for a profile photo. Broader than the
 * ServiceRequest attachment list (adds HEIC/HEIF/GIF, no PDF) — every one
 * of these is normalized to a resized WebP before it is persisted, so the
 * input format barely matters. This declared-type check is only a cheap,
 * early rejection; `UploadsController.put` re-derives the real format from
 * the bytes via `sharp`.
 */
export const ALLOWED_PROFILE_PHOTO_CONTENT_TYPES: ReadonlySet<string> = new Set(
  [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
);

/**
 * Orchestrates `Mutation.requestProfilePhotoUploadUrl` — the profiles-side
 * analog of `RequestServiceRequestAttachmentUploadUrlService`. `SessionGuard`
 * only (a draft-prep step, not an approval-gated action). Reuses the shared
 * `StoragePort` seam and persists a single-use `ProfilePhotoUploadRef` the
 * client later resubmits as `UpsertCustomer/ProfessionalProfileInput.photoUploadRef`.
 */
@Injectable()
export class RequestProfilePhotoUploadUrlService {
  private readonly logger = new Logger(
    RequestProfilePhotoUploadUrlService.name,
  );

  constructor(
    private readonly storagePort: StoragePort,
    private readonly profilesRepository: ProfilesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async requestUploadUrl(
    userId: string,
    input: RequestProfilePhotoUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    if (
      !(await this.platformSettingPort.isEnabled(
        STORAGE_SETTING_KEYS.profilePhotoUploadEnabled,
      ))
    ) {
      throw profilePhotoUploadDisabled();
    }

    if (!ALLOWED_PROFILE_PHOTO_CONTENT_TYPES.has(input.contentType)) {
      throw unsupportedProfilePhotoContentType();
    }

    const target = await this.storagePort.createUploadUrl({
      fileName: input.fileName,
      contentType: input.contentType,
    });

    const storageKey = new URL(target.publicUrl).pathname.split('/').pop()!;
    const ref = await this.profilesRepository.createProfilePhotoUploadRef({
      userId,
      storageKey,
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });

    // Never log fileUrl/storageKey — same PII discipline as the rest of
    // this module (see UpsertCustomerProfileService).
    this.logger.log({
      event: 'profile_photo_upload_requested',
      outcome: 'success',
      contentType: input.contentType,
    });

    return {
      ref: ref.id,
      uploadUrl: target.uploadUrl,
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    };
  }
}
