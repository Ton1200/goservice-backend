import { DomainException } from '../../common/errors/domain-exception';

const PROFILE_PHOTO_UPLOAD_DISABLED_CODE = 'PROFILE_PHOTO_UPLOAD_DISABLED';

/**
 * Thrown by `requestProfilePhotoUploadUrl` and by
 * `upsertCustomer/ProfessionalProfile` (when a `photoUploadRef` is
 * submitted) while the admin-managed feature toggle
 * `storage.profile-photo-upload.enabled` is off. Only the profile-photo
 * flow is gated — ServiceRequest attachments and the email logo are
 * unaffected.
 */
export function profilePhotoUploadDisabled(): DomainException {
  return new DomainException(
    PROFILE_PHOTO_UPLOAD_DISABLED_CODE,
    'Profile photo upload is currently disabled.',
  );
}
