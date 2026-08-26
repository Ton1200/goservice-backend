import { Global, Module } from '@nestjs/common';
import { LocalDevStorageAdapter } from './adapters/local-dev-storage.adapter';
import { UploadsController } from './controllers/uploads.controller';
import { StoragePort } from './ports/storage.port';

/**
 * `@Global()` — mirrors `PrismaModule` (`src/prisma/`) exactly: imported
 * ONCE, at `AppModule` root, so `StoragePort`/`LocalDevStorageAdapter` are
 * injectable from any module's own injector without that module needing to
 * import this one explicitly (see `PrismaModule`'s own header comment for
 * the same rationale).
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
  controllers: [UploadsController],
  providers: [
    LocalDevStorageAdapter,
    { provide: StoragePort, useExisting: LocalDevStorageAdapter },
  ],
  exports: [LocalDevStorageAdapter, StoragePort],
})
export class StorageModule {}
