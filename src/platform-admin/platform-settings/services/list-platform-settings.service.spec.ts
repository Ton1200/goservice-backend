import { PlatformSettingsRepository } from '../platform-settings.repository';
import { ListPlatformSettingsService } from './list-platform-settings.service';

describe('ListPlatformSettingsService', () => {
  it('delegates to PlatformSettingsRepository.findAllWithUpdatedBy() and maps rows to PlatformSettingModel', async () => {
    const rows = [
      {
        id: 'setting-1',
        key: 'customer.social-login.google.enabled',
        description: 'Gates Google sign-in.',
        valueType: 'BOOLEAN',
        isEncrypted: false,
        isPublic: true,
        value: 'true',
        ciphertext: null,
        iv: null,
        authTag: null,
        maskedPreview: null,
        provider: null,
        updatedByAdminUserId: 'admin-1',
        updatedByAdminUser: { displayName: 'Jane Admin' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ] as unknown[];
    const findAllWithUpdatedBy = jest.fn().mockResolvedValue(rows);
    const platformSettingsRepository = {
      findAllWithUpdatedBy,
    } as unknown as PlatformSettingsRepository;
    const service = new ListPlatformSettingsService(platformSettingsRepository);

    const result = await service.listPlatformSettings();

    expect(findAllWithUpdatedBy).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'setting-1',
      key: 'customer.social-login.google.enabled',
      isEncrypted: false,
      isPublic: true,
      rawValue: 'true',
      rawMaskedPreview: null,
      updatedBy: 'Jane Admin',
    });
  });
});
