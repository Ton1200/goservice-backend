import { UnsupportedMediaTypeException } from '@nestjs/common';

/**
 * GOS-70 — raised by `UploadsController.put` when the RAW BYTES of an
 * upload to an image key (`*.webp`) are not a raster image `sharp` can
 * decode, regardless of the `Content-Type` the client declared. The
 * declared content-type is only a cheap first gate at the GraphQL boundary;
 * this byte-level check is the real authority.
 *
 * A plain Nest `UnsupportedMediaTypeException` (HTTP 415), NOT a
 * `DomainException`: `/uploads/:key` is a REST route, outside both GraphQL
 * schemas and outside `DomainExceptionFilter`. The `message` carries the
 * machine-readable code so a client can branch on it the same way it does
 * on a GraphQL `extensions.code`.
 */
export const UNSUPPORTED_IMAGE_FORMAT_CODE = 'UNSUPPORTED_IMAGE_FORMAT';

export function unsupportedImageFormat(): UnsupportedMediaTypeException {
  return new UnsupportedMediaTypeException(UNSUPPORTED_IMAGE_FORMAT_CODE);
}
