import { Injectable } from '@nestjs/common';
import { PlatformSettingValueType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_SETTING_KEYS } from '../../../storage/storage-setting-keys.constants';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { PlatformSettingsRepository } from '../../platform-settings/platform-settings.repository';
import { StorageSettingsModel } from '../models/storage-settings.model';
import { UpdateStorageSettingsInput } from '../models/update-storage-settings.input';
import { GetStorageSettingsService } from './get-storage-settings.service';

/**
 * GOS-70 — writes the three `storage.*` `PlatformSetting` rows and ONE
 * `AdminAuditLog` row in the SAME `$transaction` (spans two
 * repository-owned tables, so this service owns the transaction boundary —
 * exactly like `SetPlatformSettingService`). The DTO already validated the
 * bounds; this re-reads the projected result afterwards so the response is
 * the value that will actually take effect.
 */
@Injectable()
export class UpdateStorageSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettingsRepository: PlatformSettingsRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly getStorageSettingsService: GetStorageSettingsService,
  ) {}

  async updateStorageSettings(
    adminUserId: string,
    input: UpdateStorageSettingsInput,
  ): Promise<StorageSettingsModel> {
    const rows: {
      key: string;
      description: string;
      valueType: PlatformSettingValueType;
      value: string;
    }[] = [
      {
        key: STORAGE_SETTING_KEYS.profilePhotoUploadEnabled,
        description:
          'GOS-70 — enables/disables the profile-photo upload flow (requestProfilePhotoUploadUrl + photoUploadRef).',
        valueType: PlatformSettingValueType.BOOLEAN,
        value: String(input.profilePhotoUploadEnabled),
      },
      {
        key: STORAGE_SETTING_KEYS.imageMaxDimensionPx,
        description:
          'GOS-70 — longest-edge cap (px) for every image processed by the shared storage layer.',
        valueType: PlatformSettingValueType.NUMBER,
        value: String(input.imageMaxDimensionPx),
      },
      {
        key: STORAGE_SETTING_KEYS.imageWebpQuality,
        description:
          'GOS-70 — WebP encode quality (1-100) for processed images.',
        valueType: PlatformSettingValueType.NUMBER,
        value: String(input.imageWebpQuality),
      },
    ];

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await this.platformSettingsRepository.upsert(tx, {
          key: row.key,
          description: row.description,
          valueType: row.valueType,
          isEncrypted: false,
          isPublic: false,
          value: row.value,
          ciphertext: null,
          iv: null,
          authTag: null,
          maskedPreview: null,
          provider: null,
          updatedByAdminUserId: adminUserId,
        });
      }
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'STORAGE_SETTINGS_UPDATED',
        targetType: 'PlatformSetting',
        targetKey: 'storage.*',
        metadata: {
          profilePhotoUploadEnabled: input.profilePhotoUploadEnabled,
          imageMaxDimensionPx: input.imageMaxDimensionPx,
          imageWebpQuality: input.imageWebpQuality,
        },
      });
    });

    return this.getStorageSettingsService.getStorageSettings();
  }
}
