import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { StorageUploadsDirInitializer } from './storage-uploads-dir.initializer';

function buildInitializer(uploadsDir: string): StorageUploadsDirInitializer {
  const configService = {
    get: jest.fn().mockReturnValue({ uploadsDir }),
  } as unknown as ConfigService<AppConfig, true>;
  return new StorageUploadsDirInitializer(configService);
}

describe('StorageUploadsDirInitializer', () => {
  it('creates the dir + .staging and passes the write probe', async () => {
    const base = mkdtempSync(join(tmpdir(), 'goservice-init-'));
    const dir = join(base, 'nested', 'uploads');
    try {
      await buildInitializer(dir).onModuleInit();
      expect(existsSync(join(dir, '.staging'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fails startup with a specific message when the path is not usable', async () => {
    // A FILE where the directory is expected — mkdir will fail.
    const base = mkdtempSync(join(tmpdir(), 'goservice-init-'));
    const filePath = join(base, 'not-a-dir');
    writeFileSync(filePath, 'x');
    try {
      await expect(
        buildInitializer(join(filePath, 'uploads')).onModuleInit(),
      ).rejects.toThrow(/STORAGE_LOCAL_UPLOADS_DIR/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('names the resolved path in the failure message', async () => {
    const base = mkdtempSync(join(tmpdir(), 'goservice-init-'));
    const filePath = join(base, 'blocker');
    writeFileSync(filePath, 'x');
    const badDir = join(filePath, 'uploads');
    try {
      await expect(buildInitializer(badDir).onModuleInit()).rejects.toThrow(
        badDir,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
