import { Injectable, Logger } from '@nestjs/common';
import { unsupportedProfilePhotoContentType } from '../../../profiles/errors/unsupported-profile-photo-content-type.error';
import { ALLOWED_PROFILE_PHOTO_CONTENT_TYPES } from '../../../profiles/services/request-profile-photo-upload-url.service';
import { StoragePort } from '../../../storage/ports/storage.port';
import { RequestUserProfilePhotoUploadUrlInput } from '../models/user-profile-photo.input';
import { UserProfilePhotoUploadUrlModel } from '../models/user-profile-photo-upload-url.model';

/**
 * GOS-70 — admin analog of `RequestProfilePhotoUploadUrlService`: issues a
 * signed upload slot for a profile photo an admin is attaching to a
 * consumer profile. Ref-less (see `UserProfilePhotoUploadUrlModel`) — the
 * bytes are bound to a profile by the follow-up `setUserProfilePhoto` call.
 * Same shared `StoragePort` seam and image allow-list as the consumer flow;
 * the real format is still re-checked from the bytes at `PUT /uploads/:key`.
 */
@Injectable()
export class RequestUserProfilePhotoUploadUrlService {
  private readonly logger = new Logger(
    RequestUserProfilePhotoUploadUrlService.name,
  );

  constructor(private readonly storagePort: StoragePort) {}

  async requestUploadUrl(
    input: RequestUserProfilePhotoUploadUrlInput,
  ): Promise<UserProfilePhotoUploadUrlModel> {
    if (!ALLOWED_PROFILE_PHOTO_CONTENT_TYPES.has(input.contentType)) {
      throw unsupportedProfilePhotoContentType();
    }

    const target = await this.storagePort.createUploadUrl({
      fileName: input.fileName,
      contentType: input.contentType,
    });

    this.logger.log({
      event: 'admin_user_profile_photo_upload_requested',
      outcome: 'success',
      contentType: input.contentType,
    });

    return {
      uploadUrl: target.uploadUrl,
      publicUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    };
  }
}
