import { DomainException } from '../../common/errors/domain-exception';

const UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE_CODE =
  'UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE';

/**
 * Thrown by `RequestProfilePhotoUploadUrlService` when `input.contentType`
 * isn't one of the accepted image types (see
 * `ALLOWED_PROFILE_PHOTO_CONTENT_TYPES`). This is only the cheap first
 * gate — `UploadsController.put` re-checks the real format from the bytes
 * (`UNSUPPORTED_IMAGE_FORMAT`, HTTP 415) regardless of what was declared
 * here.
 */
export function unsupportedProfilePhotoContentType(): DomainException {
  return new DomainException(
    UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE_CODE,
    'Unsupported profile photo content type.',
  );
}
