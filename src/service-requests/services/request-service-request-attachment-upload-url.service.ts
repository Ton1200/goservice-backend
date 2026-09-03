import { Injectable, Logger } from '@nestjs/common';
import { unsupportedAttachmentContentType } from '../errors/unsupported-attachment-content-type.error';
import { DocumentUploadUrlModel } from '../models/document-upload-url.model';
import { RequestServiceRequestAttachmentUploadUrlInput } from '../models/request-service-request-attachment-upload-url-input.model';
import { StoragePort } from '../../storage/ports/storage.port';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Declared-content-type allow-list — a cheap early gate only. GOS-70: every
 * image is normalized to a resized WebP by the shared storage layer
 * regardless of the input format, and `UploadsController.put` re-derives
 * the real format from the bytes, so this list only needs to be broad
 * enough to cover common camera/gallery output. `application/pdf` stays
 * (documents are stored verbatim).
 */
export const ALLOWED_ATTACHMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

/**
 * Orchestrates `Mutation.requestServiceRequestAttachmentUploadUrl`. Only
 * requires `SessionGuard` (not `AccountApprovedGuard`) — see this class's
 * own resolver for why: it's a step in preparing a draft, not itself an
 * action gated on account approval (`publishServiceRequest` — which IS
 * gated — is what actually consumes the resulting ref).
 */
@Injectable()
export class RequestServiceRequestAttachmentUploadUrlService {
  private readonly logger = new Logger(
    RequestServiceRequestAttachmentUploadUrlService.name,
  );

  constructor(
    private readonly storagePort: StoragePort,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async requestUploadUrl(
    userId: string,
    input: RequestServiceRequestAttachmentUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(input.contentType)) {
      throw unsupportedAttachmentContentType();
    }

    const target = await this.storagePort.createUploadUrl({
      fileName: input.fileName,
      contentType: input.contentType,
    });

    const storageKey = new URL(target.publicUrl).pathname.split('/').pop()!;
    const ref = await this.serviceRequestsRepository.createUploadRef({
      userId,
      storageKey,
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });

    this.logger.log({
      event: 'service_request_attachment_upload_requested',
      outcome: 'success',
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
