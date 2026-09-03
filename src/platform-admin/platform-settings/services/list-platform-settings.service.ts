import { Injectable } from '@nestjs/common';
import { STORAGE_SETTING_KEY_PREFIX } from '../../../storage/storage-setting-keys.constants';
import { PlatformSettingsRepository } from '../platform-settings.repository';
import { PlatformSettingModel } from '../models/platform-setting.model';
import { toPlatformSettingModel } from '../models/to-platform-setting-model.util';

/**
 * Thin application service wrapping
 * `PlatformSettingsRepository.findAllWithUpdatedBy()` and mapping to the
 * GraphQL-facing model — same pattern as the Slice-1/2
 * `ListFeatureFlagsService`/`ListPlatformCredentialsService` this replaces.
 */
@Injectable()
export class ListPlatformSettingsService {
  constructor(
    private readonly platformSettingsRepository: PlatformSettingsRepository,
  ) {}

  async listPlatformSettings(): Promise<PlatformSettingModel[]> {
    const rows = await this.platformSettingsRepository.findAllWithUpdatedBy();
    return (
      rows
        // GOS-70 — `storage.*` rows have their own admin surface
        // (`storageSettings`/`updateStorageSettings`, permission
        // `STORAGE_SETTINGS_*`); keep them out of the generic list so the
        // two surfaces don't overlap.
        .filter((row) => !row.key.startsWith(STORAGE_SETTING_KEY_PREFIX))
        .map((row) => toPlatformSettingModel(row))
    );
  }
}
