import { PlatformSettingsRepository } from '../../platform-settings/platform-settings.repository';
import { GetStorageSettingsService } from './get-storage-settings.service';

function makeService(rows: Record<string, { value: string } | null>): {
  service: GetStorageSettingsService;
} {
  const findByKey = jest.fn((key: string) =>
    Promise.resolve(key in rows ? rows[key] : null),
  );
  const repo = { findByKey } as unknown as PlatformSettingsRepository;
  return { service: new GetStorageSettingsService(repo) };
}

describe('GetStorageSettingsService', () => {
  it('returns defaults (enabled/1024/80) when no rows exist', async () => {
    const { service } = makeService({});
    await expect(service.getStorageSettings()).resolves.toEqual({
      profilePhotoUploadEnabled: true,
      imageMaxDimensionPx: 1024,
      imageWebpQuality: 80,
    });
  });

  it('projects stored values', async () => {
    const { service } = makeService({
      'storage.profile-photo-upload.enabled': { value: 'false' },
      'storage.image-processing.max-dimension-px': { value: '2048' },
      'storage.image-processing.webp-quality': { value: '65' },
    });
    await expect(service.getStorageSettings()).resolves.toEqual({
      profilePhotoUploadEnabled: false,
      imageMaxDimensionPx: 2048,
      imageWebpQuality: 65,
    });
  });

  it('clamps an out-of-set dimension and an out-of-range quality to defaults', async () => {
    const { service } = makeService({
      'storage.image-processing.max-dimension-px': { value: '999' },
      'storage.image-processing.webp-quality': { value: '250' },
    });
    const result = await service.getStorageSettings();
    expect(result.imageMaxDimensionPx).toBe(1024);
    expect(result.imageWebpQuality).toBe(80);
  });
});
