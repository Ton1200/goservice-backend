import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

/**
 * Uploadable-logo follow-up (2026-08-25). Mirrors
 * `RequestServiceRequestAttachmentUploadUrlInput`
 * (`src/service-requests/models/`) exactly — `contentType` is required so
 * `RequestEmailLogoUploadUrlService` can validate it against this feature's
 * own small allow-list (image only, no PDF — see
 * `ALLOWED_EMAIL_LOGO_CONTENT_TYPES`) and so `StoragePort.createUploadUrl`
 * can pick a file extension; `fileName` for a human-readable original name.
 */
@InputType()
export class RequestEmailLogoUploadUrlInput {
  @Field()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  contentType!: string;
}
