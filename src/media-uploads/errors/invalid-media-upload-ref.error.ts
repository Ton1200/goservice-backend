import { DomainException } from '../../common/errors/domain-exception';

const INVALID_MEDIA_UPLOAD_REF_CODE = 'INVALID_MEDIA_UPLOAD_REF';

/**
 * Thrown by every consumer of a `mediaUploadRefId` — `addQuoteAttachment`,
 * `postQuoteNegotiationMessage`, `sendEngagementMessage` — for ANY problem
 * with a submitted ref: it doesn't exist, belongs to a different user, was
 * already `CONSUMED`, is past its `expiresAt`, or was requested for a
 * different `intendedUse` than the one being consumed here. Deliberately ONE
 * code for all of those, same anti-enumeration reasoning as
 * `invalidAttachmentUploadRef()` (GOS-38) and
 * `invalidProfilePhotoUploadRef()` (GOS-70): a caller must not be able to
 * tell "belongs to someone else" apart from "doesn't exist" or "already
 * used".
 */
export function invalidMediaUploadRef(): DomainException {
  return new DomainException(
    INVALID_MEDIA_UPLOAD_REF_CODE,
    'One or more mediaUploadRefs are invalid, expired, already used, or for a different purpose.',
  );
}
