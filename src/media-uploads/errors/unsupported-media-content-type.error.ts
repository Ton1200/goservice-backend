import { DomainException } from '../../common/errors/domain-exception';

const UNSUPPORTED_MEDIA_CONTENT_TYPE_CODE = 'UNSUPPORTED_MEDIA_CONTENT_TYPE';

/**
 * Thrown by `RequestMediaUploadUrlService` when `input.contentType` isn't
 * one of the image-only allow-list this feature supports (see
 * `ALLOWED_MEDIA_CONTENT_TYPES`). Mirrors
 * `unsupportedAttachmentContentType()` (GOS-38) /
 * `unsupportedProfilePhotoContentType()` (GOS-70); a distinct code for a
 * distinct, image-only allow-list (no `application/pdf` — GOS-72 is
 * "imágenes"). The real format is still re-checked from the bytes at
 * `PUT /uploads/:key` by the shared storage layer.
 */
export function unsupportedMediaContentType(): DomainException {
  return new DomainException(
    UNSUPPORTED_MEDIA_CONTENT_TYPE_CODE,
    'Unsupported media content type.',
  );
}
