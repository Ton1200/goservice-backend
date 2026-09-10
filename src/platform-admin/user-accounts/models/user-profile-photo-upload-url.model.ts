import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

/**
 * GOS-70 — response of `requestUserProfilePhotoUploadUrl`. Same
 * ref-less shape as `EmailLogoUploadUrlModel`: the admin panel PUTs the
 * image to `uploadUrl`, then persists `publicUrl` via `setUserProfilePhoto`.
 * No "upload ref" tracking table (unlike the consumer
 * `requestProfilePhotoUploadUrl` flow) — an admin is not a `User`, so a
 * `ProfilePhotoUploadRef` row (whose `userId` FKs `User`) can't represent
 * the uploader.
 */
@ObjectType('UserProfilePhotoUploadUrl')
export class UserProfilePhotoUploadUrlModel {
  @Field()
  uploadUrl!: string;

  @Field()
  publicUrl!: string;

  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;
}
