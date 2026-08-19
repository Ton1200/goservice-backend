import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

/**
 * Not present in the GOS-38 ticket's original SDL draft (which showed
 * `requestServiceRequestAttachmentUploadUrl` with no arguments at all) —
 * added because it is technically necessary: `LocalDevStorageAdapter`
 * needs `contentType` to validate the allow-list
 * (`RequestServiceRequestAttachmentUploadUrlService`) and to pick a file
 * extension, and `fileName` for a human-readable original name. See the
 * GOS-38 plan's GraphQL-contract section, deviation #2, for the full
 * justification.
 */
@InputType()
export class RequestServiceRequestAttachmentUploadUrlInput {
  @Field()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  contentType!: string;
}
