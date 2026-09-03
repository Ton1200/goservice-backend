import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * GOS-70 — the admin-editable storage / image-processing knobs, surfaced on
 * `/admin/graphql` by `AdminStorageSettingsResolver` (gated by
 * `STORAGE_SETTINGS_READ`). Backed by three `PlatformSetting` rows under
 * the `storage.` prefix, which the generic `platformSettings` /
 * `setPlatformSetting` surface deliberately excludes.
 */
@ObjectType('StorageSettings')
export class StorageSettingsModel {
  @Field(() => Boolean, {
    description:
      'Whether the profile-photo upload flow is enabled (requestProfilePhotoUploadUrl + photoUploadRef). Does NOT affect ServiceRequest attachments or the email logo.',
  })
  profilePhotoUploadEnabled!: boolean;

  @Field(() => Int, {
    description:
      'Longest-edge cap (px) applied to every image processed by the shared storage layer. One of 512, 1024, 2048.',
  })
  imageMaxDimensionPx!: number;

  @Field(() => Int, {
    description: 'WebP encode quality (1-100) for processed images.',
  })
  imageWebpQuality!: number;
}
