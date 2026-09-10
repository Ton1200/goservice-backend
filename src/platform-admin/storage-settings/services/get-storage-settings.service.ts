import { Injectable } from '@nestjs/common';
import {
  IMAGE_MAX_DIMENSION_PX_CHOICES,
  IMAGE_MAX_DIMENSION_PX_DEFAULT,
  IMAGE_WEBP_QUALITY_DEFAULT,
  IMAGE_WEBP_QUALITY_MAX,
  IMAGE_WEBP_QUALITY_MIN,
  STORAGE_SETTING_KEYS,
} from '../../../storage/storage-setting-keys.constants';
import { PlatformSettingsRepository } from '../../platform-settings/platform-settings.repository';
import { StorageSettingsModel } from '../models/storage-settings.model';

/**
 * GOS-70 — reads the three `storage.*` `PlatformSetting` rows and projects
 * them into `StorageSettingsModel`, applying the same defaults/clamping the
 * runtime consumers (`ImageProcessor`,
 * `RequestProfilePhotoUploadUrlService`) use, so the admin panel always
 * shows the value that will actually take effect — even before any row has
 * been written.
 */
@Injectable()
export class GetStorageSettingsService {
  constructor(
    private readonly platformSettingsRepository: PlatformSettingsRepository,
  ) {}

  async getStorageSettings(): Promise<StorageSettingsModel> {
    const [enabledRow, maxDimRow, qualityRow] = await Promise.all([
      this.platformSettingsRepository.findByKey(
        STORAGE_SETTING_KEYS.profilePhotoUploadEnabled,
      ),
      this.platformSettingsRepository.findByKey(
        STORAGE_SETTING_KEYS.imageMaxDimensionPx,
      ),
      this.platformSettingsRepository.findByKey(
        STORAGE_SETTING_KEYS.imageWebpQuality,
      ),
    ]);

    return {
      // Fail-open, matching `PlatformSettingPort.isEnabled`: a missing row
      // means the feature is on.
      profilePhotoUploadEnabled: enabledRow
        ? enabledRow.value === 'true'
        : true,
      imageMaxDimensionPx: this.clampMaxDimension(maxDimRow?.value ?? null),
      imageWebpQuality: this.clampQuality(qualityRow?.value ?? null),
    };
  }

  private clampMaxDimension(raw: string | null): number {
    const parsed = Number(raw);
    return raw !== null &&
      (IMAGE_MAX_DIMENSION_PX_CHOICES as readonly number[]).includes(parsed)
      ? parsed
      : IMAGE_MAX_DIMENSION_PX_DEFAULT;
  }

  private clampQuality(raw: string | null): number {
    const parsed = Number(raw);
    return raw !== null &&
      Number.isInteger(parsed) &&
      parsed >= IMAGE_WEBP_QUALITY_MIN &&
      parsed <= IMAGE_WEBP_QUALITY_MAX
      ? parsed
      : IMAGE_WEBP_QUALITY_DEFAULT;
  }
}
