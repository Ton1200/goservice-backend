import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/**
 * Input for `addQuoteAttachment` — the opaque `MediaUploadRef.id`s the
 * client received from `requestMediaUploadUrl(intendedUse: QUOTE_ATTACHMENT)`
 * and PUT bytes for. Resubmitted unmodified; consumed (validated + marked
 * `CONSUMED`) atomically alongside the `QuoteAttachment` rows they become.
 * Order is preserved into `QuoteAttachment.order`, same as
 * `PublishServiceRequestInput.attachmentUploadRefs` (GOS-38).
 */
@InputType()
export class AddQuoteAttachmentInput {
  @Field(() => [ID])
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  mediaUploadRefIds!: string[];
}
