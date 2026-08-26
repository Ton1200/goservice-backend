import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';
import { EmailTemplatesModule } from '../platform-admin/email-templates/email-templates.module';
import { EmailProviderRouterAdapter } from './adapters/email-provider-router.adapter';
import { MailpitEmailClientAdapter } from './adapters/mailpit-email-client.adapter';
import { ResendEmailClientAdapter } from './adapters/resend-email-client.adapter';
import { EmailClientPort } from './ports/email-client.port';
import {
  EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
  EMAIL_QUEUE_NAME,
} from './queue/email-queue.constants';
import { EmailQueueProcessor } from './queue/email-queue.processor';
import { EmailQueueService } from './queue/email-queue.service';
import { EnsureEmailDeliveryAvailableService } from './services/ensure-email-delivery-available.service';
import { EmailTemplateRenderer } from './templates/email-template-renderer.service';

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
 *
 * `EmailClientPort` is bound to `EmailProviderRouterAdapter`, NOT directly
 * to `ResendEmailClientAdapter` (added alongside Mailpit as a local-dev-only
 * email catcher — see ADR 0004's dated update and the router's own header
 * comment): the router decides per-send whether Resend or Mailpit actually
 * handles the message. `ResendEmailClientAdapter` and
 * `MailpitEmailClientAdapter` remain ordinary providers the router depends
 * on — nothing else should inject either directly.
 *
 * `EmailTemplatesModule` (editable transactional-email templates follow-up,
 * 2026-08-24): imported AND RE-EXPORTED (listed in `exports` below, not just
 * `imports`) so `EmailTemplatePort` becomes reachable by every module that
 * already imports `EmailModule` for `EmailQueueService`
 * (`UsersModule`/`PasswordResetModule`/`PlatformAdminModule`, the last of
 * which uses it for the `admin-invites` sender adapter) — see
 * `EmailTemplatesModule`'s own header comment for why it, too, is
 * deliberately resolver-free.
 *
 * `EmailTemplateRenderer` (shared header/footer follow-up, 2026-08-25) is a
 * provider+export of THIS module, not of `EmailTemplatesModule` — it only
 * depends on `EmailTemplatePort`/`EmailLayoutPort`, both already reachable
 * here via the imported `EmailTemplatesModule`, so there is no need to widen
 * that (deliberately resolver-free, minimal) module's own responsibility.
 * It is now the ONE place a template + the shared layout are composed into
 * a final subject/text/html — every sender adapter and
 * `SendTestEmailTemplateService` inject THIS instead of
 * `EmailTemplatePort`+`renderEmailTemplate` directly. See its own header
 * comment (`src/email/templates/email-template-renderer.service.ts`) for
 * the full composition contract.
 */
@Module({
  imports: [
    PlatformSettingsModule,
    EmailTemplatesModule,
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
      defaultJobOptions: EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  providers: [
    ResendEmailClientAdapter,
    MailpitEmailClientAdapter,
    { provide: EmailClientPort, useClass: EmailProviderRouterAdapter },
    EmailQueueProcessor,
    EmailQueueService,
    EnsureEmailDeliveryAvailableService,
    EmailTemplateRenderer,
  ],
  exports: [
    EmailQueueService,
    EnsureEmailDeliveryAvailableService,
    EmailTemplatesModule,
    EmailTemplateRenderer,
  ],
})
export class EmailModule {}
