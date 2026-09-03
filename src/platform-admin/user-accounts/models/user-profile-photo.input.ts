import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsString, IsUUID, MinLength } from 'class-validator';
import { AdminProfileKind } from './admin-profile-kind.enum';

/**
 * GOS-70 — issues a signed upload slot for a profile photo an admin is
 * about to attach to a consumer profile. Slot-only (no `userId`): the photo
 * is bound to a profile by the follow-up `setUserProfilePhoto` call.
 */
@InputType()
export class RequestUserProfilePhotoUploadUrlInput {
  @Field()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Field()
  @IsString()
  @MinLength(1)
  contentType!: string;
}

@InputType()
export class SetUserProfilePhotoInput {
  @Field(() => ID)
  @IsUUID()
  userId!: string;

  // `@IsEnum` is load-bearing, not decorative: the global
  // `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
  // strips/rejects any DTO property with ZERO class-validator decorators as
  // "should not exist" — same note as `SetPlatformSettingInput.valueType`.
  @Field(() => AdminProfileKind)
  @IsEnum(AdminProfileKind)
  profileKind!: AdminProfileKind;

  /**
   * Must be a `publicUrl` returned by `requestUserProfilePhotoUploadUrl`
   * (a processed image in this backend's own storage) — validated
   * server-side, never an arbitrary external URL.
   */
  @Field()
  @IsString()
  @MinLength(1)
  photoUrl!: string;
}

@InputType()
export class RemoveUserProfilePhotoInput {
  @Field(() => ID)
  @IsUUID()
  userId!: string;

  // `@IsEnum` is load-bearing, not decorative: the global
  // `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
  // strips/rejects any DTO property with ZERO class-validator decorators as
  // "should not exist" — same note as `SetPlatformSettingInput.valueType`.
  @Field(() => AdminProfileKind)
  @IsEnum(AdminProfileKind)
  profileKind!: AdminProfileKind;
}
