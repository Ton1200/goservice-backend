import { Injectable } from '@nestjs/common';
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
    return rows.map((row) => toPlatformSettingModel(row));
  }
}
