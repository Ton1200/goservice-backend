import { DomainException } from '../../common/errors/domain-exception';

const INVALID_PROFILE_PHOTO_UPLOAD_REF_CODE =
  'INVALID_PROFILE_PHOTO_UPLOAD_REF';

/**
 * Thrown by `upsertCustomerProfile`/`upsertProfessionalProfile` for ANY
 * problem with a submitted `photoUploadRef` — deliberately ONE code
 * covering four distinct causes (ref doesn't exist, belongs to a different
 * user, already `CONSUMED`, or past its `expiresAt`). Same anti-enumeration
 * reasoning as `invalidAttachmentUploadRef()`.
 */
export function invalidProfilePhotoUploadRef(): DomainException {
  return new DomainException(
    INVALID_PROFILE_PHOTO_UPLOAD_REF_CODE,
    'The photoUploadRef is invalid, expired, or already used.',
  );
}
