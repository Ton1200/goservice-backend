import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { PlatformSettingsRepository } from '../../platform-settings/platform-settings.repository';
import { GetStorageSettingsService } from './get-storage-settings.service';
import { UpdateStorageSettingsService } from './update-storage-settings.service';

describe('UpdateStorageSettingsService', () => {
  function makeService() {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const platformSettingsRepository = {
      upsert,
    } as unknown as PlatformSettingsRepository;
    const write = jest.fn().mockResolvedValue(undefined);
    const auditLogRepository = { write } as unknown as AuditLogRepository;
    const prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
    } as unknown as PrismaService;
    const getStorageSettings = jest.fn().mockResolvedValue({
      profilePhotoUploadEnabled: false,
      imageMaxDimensionPx: 512,
      imageWebpQuality: 60,
    });
    const getStorageSettingsService = {
      getStorageSettings,
    } as unknown as GetStorageSettingsService;

    const service = new UpdateStorageSettingsService(
      prisma,
      platformSettingsRepository,
      auditLogRepository,
      getStorageSettingsService,
    );
    return { service, upsert, write, getStorageSettings };
  }

  it('upserts all three storage.* rows and one audit row in a transaction, then re-reads', async () => {
    const { service, upsert, write, getStorageSettings } = makeService();

    const result = await service.updateStorageSettings('admin-1', {
      profilePhotoUploadEnabled: false,
      imageMaxDimensionPx: 512,
      imageWebpQuality: 60,
    });

    const keys = (upsert.mock.calls as unknown[][]).map(
      (c) => (c[1] as { key: string }).key,
    );
    expect(keys).toEqual([
      'storage.profile-photo-upload.enabled',
      'storage.image-processing.max-dimension-px',
      'storage.image-processing.webp-quality',
    ]);
    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        key: 'storage.image-processing.max-dimension-px',
        value: '512',
        isEncrypted: false,
        isPublic: false,
        updatedByAdminUserId: 'admin-1',
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STORAGE_SETTINGS_UPDATED',
        targetType: 'PlatformSetting',
        actorAdminUserId: 'admin-1',
      }),
    );
    expect(getStorageSettings).toHaveBeenCalled();
    expect(result).toEqual({
      profilePhotoUploadEnabled: false,
      imageMaxDimensionPx: 512,
      imageWebpQuality: 60,
    });
  });
});
