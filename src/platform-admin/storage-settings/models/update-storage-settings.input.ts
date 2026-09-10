import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import {
  IMAGE_MAX_DIMENSION_PX_CHOICES,
  IMAGE_WEBP_QUALITY_MAX,
  IMAGE_WEBP_QUALITY_MIN,
} from '../../../storage/storage-setting-keys.constants';

/**
 * GOS-70 — full desired state of the storage settings on every call (no
 * partial patch), same convention as `SetPlatformSettingInput` /
 * `UpdateEmailLayoutInput`. `UpdateStorageSettingsService` re-validates
 * these bounds server-side (defense in depth) before writing.
 */
@InputType()
export class UpdateStorageSettingsInput {
  @Field(() => Boolean)
  @IsBoolean()
  profilePhotoUploadEnabled!: boolean;

  @Field(() => Int)
  @IsInt()
  @IsIn(IMAGE_MAX_DIMENSION_PX_CHOICES)
  imageMaxDimensionPx!: number;

  @Field(() => Int)
  @IsInt()
  @Min(IMAGE_WEBP_QUALITY_MIN)
  @Max(IMAGE_WEBP_QUALITY_MAX)
  imageWebpQuality!: number;
}
