import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

/**
 * Response of `requestEmailLogoUploadUrl` — uploadable-logo follow-up
 * (2026-08-25). Deliberately WITHOUT a `ref`/`fileUrl`-consumed-later shape
 * like `DocumentUploadUrlModel`
 * (`src/service-requests/models/document-upload-url.model.ts`): there is no
 * "upload ref" tracking table for this feature (unlike
 * `ServiceRequestAttachmentUploadRef`) — the admin panel PUTs the file to
 * `uploadUrl`, then immediately persists `publicUrl` itself via the
 * already-existing `updateEmailLayout` mutation's `logoUrl` field. No
 * separate "consume this ref" step exists.
 */
@ObjectType('EmailLogoUploadUrl')
export class EmailLogoUploadUrlModel {
  @Field()
  uploadUrl!: string;

  @Field()
  publicUrl!: string;

  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;
}
