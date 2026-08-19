import { DomainException } from '../../common/errors/domain-exception';

const INVALID_ATTACHMENT_UPLOAD_REF_CODE = 'INVALID_ATTACHMENT_UPLOAD_REF';

/**
 * Thrown by `PublishServiceRequestService` for ANY problem with a submitted
 * `attachmentUploadRefs` entry — deliberately ONE code covering four
 * distinct causes (ref doesn't exist, belongs to a different user, already
 * `CONSUMED` by an earlier publish, or past its `expiresAt`). Same
 * anti-enumeration reasoning as `serviceRequestNotFound()`: a caller must
 * not be able to tell "this ref belongs to someone else" apart from "this
 * ref doesn't exist" or "this ref was already used."
 */
export function invalidAttachmentUploadRef(): DomainException {
  return new DomainException(
    INVALID_ATTACHMENT_UPLOAD_REF_CODE,
    'One or more attachmentUploadRefs are invalid, expired, or already used.',
  );
}
