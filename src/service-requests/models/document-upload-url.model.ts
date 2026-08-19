import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * Response of `requestServiceRequestAttachmentUploadUrl`. `ref` is the
 * opaque `ServiceRequestAttachmentUploadRef.id` — the client resubmits it
 * (unmodified) inside `PublishServiceRequestInput.attachmentUploadRefs`.
 * `uploadUrl` is where the client PUTs the raw file bytes (outside
 * GraphQL); `fileUrl` is the URL that ends up on the resulting
 * `ServiceRequestAttachment.url` once `publishServiceRequest` consumes this
 * ref. Named `DocumentUploadUrl` to match the GOS-38 ticket's own SDL.
 */
@ObjectType('DocumentUploadUrl')
export class DocumentUploadUrlModel {
  @Field(() => ID)
  ref!: string;

  @Field()
  uploadUrl!: string;

  @Field()
  fileUrl!: string;

  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;
}
