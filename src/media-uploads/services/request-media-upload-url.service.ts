import { Injectable, Logger } from '@nestjs/common';
import { DocumentUploadUrlModel } from '../../service-requests/models/document-upload-url.model';
import { StoragePort } from '../../storage/ports/storage.port';
import { unsupportedMediaContentType } from '../errors/unsupported-media-content-type.error';
import { MediaUploadsRepository } from '../media-uploads.repository';
import { RequestMediaUploadUrlInput } from '../models/request-media-upload-url-input.model';

/**
 * Declared-content-type allow-list — a cheap early gate only, image-only
 * (no `application/pdf`: GOS-72 is "imágenes"). Mirrors GOS-70's
 * `ALLOWED_PROFILE_PHOTO_CONTENT_TYPES`. The shared storage layer re-derives
 * the real format from the bytes at `PUT /uploads/:key` and normalizes every
 * image to a resized WebP regardless of the declared type, so this list only
 * needs to be broad enough to cover common camera/gallery output.
 */
export const ALLOWED_MEDIA_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

/**
 * Orchestrates `Mutation.requestMediaUploadUrl` — GOS-72's single generic
 * "request a signed image upload slot" step, shared by all three consuming
 * mutations (`addQuoteAttachment`, `postQuoteNegotiationMessage`,
 * `sendEngagementMessage`), discriminated by `input.intendedUse`.
 *
 * Requires only `SessionGuard` (not `AccountApprovedGuard`) — same posture
 * as `requestServiceRequestAttachmentUploadUrl` /
 * `requestProfilePhotoUploadUrl`: preparing a draft upload slot is not
 * itself an approval-gated action; the mutation that CONSUMES the resulting
 * ref is what carries the approval gate.
 *
 * `userId` is ALWAYS the server-derived `@CurrentUser()` — never a
 * client-supplied value. Which specific Quote/message a ref may be spent on
 * is validated later, at consume time, not here.
 */
@Injectable()
export class RequestMediaUploadUrlService {
  private readonly logger = new Logger(RequestMediaUploadUrlService.name);

  constructor(
    private readonly storagePort: StoragePort,
    private readonly mediaUploadsRepository: MediaUploadsRepository,
  ) {}

  async requestUploadUrl(
    userId: string,
    input: RequestMediaUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    if (!ALLOWED_MEDIA_CONTENT_TYPES.has(input.contentType)) {
      throw unsupportedMediaContentType();
    }

    const target = await this.storagePort.createUploadUrl({
      fileName: input.fileName,
      contentType: input.contentType,
    });

    const storageKey = new URL(target.publicUrl).pathname.split('/').pop()!;
    const ref = await this.mediaUploadsRepository.createRef({
      userId,
      storageKey,
      fileUrl: target.publicUrl,
      intendedUse: input.intendedUse,
      expiresAt: target.expiresAt,
    });

    this.logger.log({
      event: 'media_upload_requested',
      outcome: 'success',
      intendedUse: input.intendedUse,
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
