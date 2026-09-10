import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

/**
 * GOS-70 — input to `requestProfilePhotoUploadUrl`. Same shape as
 * `RequestServiceRequestAttachmentUploadUrlInput`: `contentType` gates the
 * cheap image allow-list (`ALLOWED_PROFILE_PHOTO_CONTENT_TYPES`) and drives
 * the `.webp` key extension; `fileName` is only a human-readable original
 * name. The real format check happens on the uploaded bytes at
 * `PUT /uploads/:key`.
 */
@InputType()
export class RequestProfilePhotoUploadUrlInput {
  @Field()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  contentType!: string;
}
