import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { MediaUploadRefIntendedUse } from './media-upload-ref-intended-use.enum';

/**
 * Input for `requestMediaUploadUrl`. The GOS-72 ticket sketched the mutation
 * as `requestMediaUploadUrl(intendedUse:)` with no other arguments —
 * `fileName`/`contentType` are added here for the exact same technical
 * reason GOS-38 documented for `RequestServiceRequestAttachmentUploadUrlInput`:
 * `StoragePort.createUploadUrl` needs `contentType` to validate the
 * image-only allow-list (`RequestMediaUploadUrlService`) and to pick the
 * storage extension (every `image/*` becomes a `.webp` key), and `fileName`
 * for a human-readable original name.
 */
@InputType()
export class RequestMediaUploadUrlInput {
  @Field(() => MediaUploadRefIntendedUse)
  @IsEnum(MediaUploadRefIntendedUse)
  intendedUse!: MediaUploadRefIntendedUse;

  @Field()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  contentType!: string;
}
