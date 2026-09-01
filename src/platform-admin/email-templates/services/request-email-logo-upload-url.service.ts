import { Injectable, Logger } from '@nestjs/common';
import { StoragePort } from '../../../service-requests/ports/storage.port';
import { unsupportedEmailLogoContentType } from '../errors/email-layout.errors';
import { EmailLogoUploadUrlModel } from '../models/email-logo-upload-url.model';
import { RequestEmailLogoUploadUrlInput } from '../models/request-email-logo-upload-url.input';

/**
 * Small, deliberate allow-list — image only, no PDF (unlike
 * `ALLOWED_ATTACHMENT_CONTENT_TYPES` in
 * `src/service-requests/services/request-service-request-attachment-upload-url.service.ts`,
 * which this otherwise mirrors): a logo is always an image.
 */
export const ALLOWED_EMAIL_LOGO_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Orchestrates `Mutation.requestEmailLogoUploadUrl` — uploadable-logo
 * follow-up (2026-08-25). Reuses the EXISTING GOS-38 `StoragePort` seam
 * (`src/service-requests/ports/storage.port.ts`) directly, rather than
 * building any new storage plumbing for this feature — see this feature's
 * own plan for why (`LocalDevStorageAdapter`/`UploadsController` are
 * provider-agnostic by design, serving any `key` regardless of which
 * feature requested the upload URL).
 *
 * UNLIKE `RequestServiceRequestAttachmentUploadUrlService`, there is no
 * "upload ref" tracking table/repository call here — this feature has no
 * pending-attachment-consumed-later flow to track; the resulting
 * `publicUrl` is persisted directly onto `EmailLayout.logoUrl` by the
 * caller (the admin panel), via the already-existing `updateEmailLayout`
 * mutation, as soon as the PUT succeeds.
 */
@Injectable()
export class RequestEmailLogoUploadUrlService {
  private readonly logger = new Logger(RequestEmailLogoUploadUrlService.name);

  constructor(private readonly storagePort: StoragePort) {}

  async requestUploadUrl(
    input: RequestEmailLogoUploadUrlInput,
  ): Promise<EmailLogoUploadUrlModel> {
    if (!ALLOWED_EMAIL_LOGO_CONTENT_TYPES.has(input.contentType)) {
      throw unsupportedEmailLogoContentType();
    }

    const target = await this.storagePort.createUploadUrl({
      fileName: input.fileName,
      contentType: input.contentType,
    });

    this.logger.log({
      event: 'email_logo_upload_requested',
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
