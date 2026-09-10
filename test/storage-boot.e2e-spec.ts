import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestApp } from './support/test-app';

/**
 * GOS-70 — `StorageUploadsDirInitializer` (`OnModuleInit` on a provider in
 * the `@Global()` StorageModule) verifies the uploads directory is writable
 * at boot. A bogus `STORAGE_LOCAL_UPLOADS_DIR` must fail `app.init()` (which
 * `createTestApp()` calls) with a clear, specific message naming the
 * variable — never surface only on a user's first upload.
 */
describe('StorageModule boot-time uploads-dir check (e2e, GOS-70)', () => {
  it('fails app startup with a clear message when STORAGE_LOCAL_UPLOADS_DIR is unusable', async () => {
    const base = mkdtempSync(join(tmpdir(), 'goservice-storage-boot-'));
    const blocker = join(base, 'blocker-file');
    writeFileSync(blocker, 'x'); // a FILE where a directory is expected
    const unusableDir = join(blocker, 'uploads');

    try {
      await expect(
        createTestApp({ storageLocalUploadsDir: unusableDir }),
      ).rejects.toThrow(/STORAGE_LOCAL_UPLOADS_DIR/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
