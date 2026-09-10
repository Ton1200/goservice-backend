import { randomBytes } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/**
 * GOS-70 — verifies the uploads directory (`STORAGE_LOCAL_UPLOADS_DIR`,
 * resolved in `configuration.ts`) exists and is writable BEFORE the app
 * finishes starting, so a misconfigured path fails `nest start` with a
 * clear, specific message instead of surfacing on some user's first upload.
 *
 * `OnModuleInit` on a provider — the same fail-fast hook `PrismaService`
 * uses for `$connect()`. It runs under the e2e path too (`createTestApp()`
 * builds the real `AppModule` and calls `app.init()`), which the
 * boot-failure test relies on.
 *
 * Deliberately its OWN provider, not a method on `LocalDevStorageAdapter`:
 * a real object-storage adapter has no local directory, and keeping the
 * probe out of the `StoragePort` implementation keeps that swap clean.
 */
@Injectable()
export class StorageUploadsDirInitializer implements OnModuleInit {
  private readonly logger = new Logger(StorageUploadsDirInitializer.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async onModuleInit(): Promise<void> {
    const dir = this.configService.get('storageLocal', {
      infer: true,
    }).uploadsDir;
    try {
      // Create both the uploads dir and its `.staging/` sub-dir up front.
      await mkdir(join(dir, '.staging'), { recursive: true });
      const probePath = join(
        dir,
        `.write-probe-${process.pid}-${randomBytes(6).toString('hex')}`,
      );
      await writeFile(probePath, '');
      await unlink(probePath);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[StorageModule] Uploads directory is not usable: "${dir}" ` +
          `(resolved from STORAGE_LOCAL_UPLOADS_DIR, default "./var/uploads"). ` +
          `Create it and grant this process write permission, or set ` +
          `STORAGE_LOCAL_UPLOADS_DIR to a writable path. Cause: ${cause}`,
      );
    }
    this.logger.log({ event: 'storage_uploads_dir_verified' });
  }
}
