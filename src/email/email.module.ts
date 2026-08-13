import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { ResendEmailClientAdapter } from './adapters/resend-email-client.adapter';
import { EmailClientPort } from './ports/email-client.port';
import {
  EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
  EMAIL_QUEUE_NAME,
} from './queue/email-queue.constants';
import { EmailQueueProcessor } from './queue/email-queue.processor';
import { EmailQueueService } from './queue/email-queue.service';
import { EnsureEmailDeliveryAvailableService } from './services/ensure-email-delivery-available.service';

/**
 * Shared email-sending infrastructure: a BullMQ queue backed by the
 * project's existing Redis instance (see `BullModule.forRootAsync` in
 * `app.module.ts` for the connection), a worker that delivers via Resend,
 * and `EmailQueueService` as the only seam other modules should depend on.
 * Intended to be reused by future email-sending features (e.g. GOS-9
 * forgot-password), not just verification codes.
 *
 * `PlatformSettingsModule` (GOS-3x follow-up, 2026-08-10): imported so
 * `ResendEmailClientAdapter` and `EnsureEmailDeliveryAvailableService` can
 * both reach `PlatformSettingPort` — the Resend provider's
 * enabled/api-key/from-address/from-name are now admin-managed
 * `PlatformSetting` rows instead of `ConfigService`/`.env` values. See
 * `PlatformSettingsModule`'s own header comment for why it's deliberately
 * resolver-free and safe to import here.
 */
@Module({
  imports: [
    PlatformSettingsModule,
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
      defaultJobOptions: EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  providers: [
    { provide: EmailClientPort, useClass: ResendEmailClientAdapter },
    EmailQueueProcessor,
    EmailQueueService,
    EnsureEmailDeliveryAvailableService,
  ],
  exports: [EmailQueueService, EnsureEmailDeliveryAvailableService],
})
export class EmailModule {}
