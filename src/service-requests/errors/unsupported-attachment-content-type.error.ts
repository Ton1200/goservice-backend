import { DomainException } from '../../common/errors/domain-exception';

const UNSUPPORTED_ATTACHMENT_CONTENT_TYPE_CODE =
  'UNSUPPORTED_ATTACHMENT_CONTENT_TYPE';

/**
 * Thrown by `RequestServiceRequestAttachmentUploadUrlService` when
 * `input.contentType` isn't one of the small allow-list this module
 * supports (see `ALLOWED_ATTACHMENT_CONTENT_TYPES`).
 */
export function unsupportedAttachmentContentType(): DomainException {
  return new DomainException(
    UNSUPPORTED_ATTACHMENT_CONTENT_TYPE_CODE,
    'Unsupported attachment content type.',
  );
}
