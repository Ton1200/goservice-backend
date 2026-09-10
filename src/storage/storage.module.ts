import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { LocalDevStorageAdapter } from './adapters/local-dev-storage.adapter';
import { UploadsController } from './controllers/uploads.controller';
import { ImageProcessor } from './image/image-processor';
import { StoragePort } from './ports/storage.port';
import {
  IMAGE_PROCESSING_DEFAULT_JOB_OPTIONS,
  IMAGE_PROCESSING_QUEUE_NAME,
} from './queue/image-processing.constants';
import { ImageProcessingProcessor } from './queue/image-processing.processor';
import { ImageProcessingService } from './queue/image-processing.service';
import { StorageUploadsDirInitializer } from './storage-uploads-dir.initializer';

/**
 * `@Global()` — mirrors `PrismaModule` (`src/prisma/`) exactly: imported
 * ONCE, at `AppModule` root, so `StoragePort`/`LocalDevStorageAdapter` are
 * injectable from any module's own injector without that module needing to
 * import this one explicitly (see `PrismaModule`'s own header comment for
 * the same rationale).
 *
 * Relocated to its own top-level `src/storage/` module (GOS-70,
 * 2026-09-02) and given server-side image processing (`ImageProcessor` +
 * the BullMQ `image-processing` queue) plus a boot-time writable-directory
 * check (`StorageUploadsDirInitializer`). Still `@Global()`, still imported
 * exactly once at `AppModule` root.
 *
 * EXTRACTED from `ServiceRequestsModule` (uploadable-logo follow-up,
 * 2026-08-25) specifically BECAUSE more than one module now needs
 * `StoragePort` (`ServiceRequestsModule` for attachment uploads,
 * `PlatformAdminModule` for the shared email-layout logo upload) — this is
 * NOT just a style preference. `LocalDevStorageAdapter` generates a fresh
 * random `signingSecret` ONCE PER INSTANCE when
 * `storageLocal.signingSecret` is unset in config (see that adapter's own
 * header comment, "held for this adapter instance's lifetime — the whole
 * app process"). If `ServiceRequestsModule` and `PlatformAdminModule` each
 * re-declared their OWN `LocalDevStorageAdapter` provider (as originally
 * sketched), they would end up as two DIFFERENT singleton instances in the
 * SAME process, each with its OWN random secret whenever
 * `STORAGE_LOCAL_SIGNING_SECRET` is unset (true for every environment
 * verified so far, including e2e) — an upload URL issued via
 * `requestEmailLogoUploadUrl` (signed with `PlatformAdminModule`'s
 * instance's secret) would then FAIL `UploadsController.put`'s token
 * verification, since `UploadsController` is wired to whichever single
 * instance the module that declares it resolves. A single `@Global()`
 * module removes that class of bug entirely: exactly ONE
 * `LocalDevStorageAdapter` instance (and therefore ONE signing secret) for
 * the whole process, regardless of how many features request an upload
 * slot. `UploadsController` moves here too — the actual PUT/GET target for
 * whichever single adapter instance this module provides — rather than
 * staying declared on `ServiceRequestsModule`, which no longer has any
 * exclusive claim to it.
 *
 * The real object-storage provider (S3/Cloudinary/Azure Blob/other) is
 * still an explicitly OPEN infrastructure decision (see
 * infrastructure.md) — swapping `LocalDevStorageAdapter` for a real
 * provider adapter later is one new class + one `useClass`/`useExisting`
 * change, HERE, in this one module — never a resolver/service/schema
 * change in any consumer.
 */
@Global()
@Module({
  imports: [
    // Resolver-free (see its header comment) — safe to import from this
    // `@Global()` module for `PlatformSettingPort` (image size/quality live
    // in admin-managed `storage.image-processing.*` settings).
    PlatformSettingsModule,
    // BullMQ connection itself is registered once in `app.module.ts`
    // (`BullModule.forRootAsync`); this only declares the queue.
    BullModule.registerQueue({
      name: IMAGE_PROCESSING_QUEUE_NAME,
      defaultJobOptions: IMAGE_PROCESSING_DEFAULT_JOB_OPTIONS,
    }),
  ],
  controllers: [UploadsController],
  providers: [
    LocalDevStorageAdapter,
    { provide: StoragePort, useExisting: LocalDevStorageAdapter },
    ImageProcessor,
    ImageProcessingService,
    ImageProcessingProcessor,
    StorageUploadsDirInitializer,
  ],
  // `ImageProcessor` / `ImageProcessingService` are exported so GOS-72
  // (Quote attachments) can reuse the exact same processing pipeline.
  exports: [
    LocalDevStorageAdapter,
    StoragePort,
    ImageProcessor,
    ImageProcessingService,
  ],
})
export class StorageModule {}
