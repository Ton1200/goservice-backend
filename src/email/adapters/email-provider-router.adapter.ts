import { Injectable, Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  EMAIL_PROVIDER_SETTING_KEY,
  EMAIL_PROVIDERS,
} from '../constants/email-provider-settings.constants';
import { emailDeliveryMisconfigured } from '../errors/email-delivery-misconfigured.error';
import {
  EmailClientPort,
  OutboundEmailMessage,
} from '../ports/email-client.port';
import { MailpitEmailClientAdapter } from './mailpit-email-client.adapter';
import { ResendEmailClientAdapter } from './resend-email-client.adapter';

/**
 * The actual `EmailClientPort` binding (see `EmailModule`) — decides, on
 * every send, which real channel handles this message: Resend (the only
 * production-capable channel) or Mailpit (a local-dev-only email catcher,
 * see `MailpitEmailClientAdapter`'s own doc comment). Introduced alongside
 * Mailpit specifically so `EmailQueueProcessor`/`ResendEmailClientAdapter`
 * never need to know Mailpit exists at all — mirrors the same "read
 * PlatformSetting live, per call, never cache at construction" discipline
 * `ResendEmailClientAdapter` already established.
 *
 * PRODUCTION SAFETY (see ADR 0004's dated update on this): `MAILPIT` is
 * NEVER honored when `NODE_ENV=production`, regardless of what
 * `notifications.email.provider` is set to — fails LOUDLY with
 * `EMAIL_DELIVERY_MISCONFIGURED` instead of either (a) silently sending via
 * Resend behind whoever set that value's back, or (b) trying to reach a
 * Mailpit container that doesn't exist in production. This mirrors
 * `EnsureEmailDeliveryAvailableService`'s OWN identical check
 * (`ensureAvailable()`, called upfront by every GraphQL mutation before a
 * job is even enqueued) — that is the primary gate; this is
 * defense-in-depth for a job that reaches this worker after the setting
 * changed mid-flight (e.g. `MAILPIT` was selected, then the same
 * environment was promoted to production without the setting being reset).
 */
@Injectable()
export class EmailProviderRouterAdapter implements EmailClientPort {
  private readonly logger = new Logger(EmailProviderRouterAdapter.name);

  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly resendEmailClientAdapter: ResendEmailClientAdapter,
    private readonly mailpitEmailClientAdapter: MailpitEmailClientAdapter,
  ) {}

  async send(message: OutboundEmailMessage): Promise<void> {
    const provider = await this.platformSettingPort.getValue(
      EMAIL_PROVIDER_SETTING_KEY,
    );

    if (provider === EMAIL_PROVIDERS.MAILPIT) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn({
          event: 'email_provider_mailpit_blocked_in_production',
        });
        throw emailDeliveryMisconfigured();
      }
      return this.mailpitEmailClientAdapter.send(message);
    }

    // Missing row, `RESEND`, or any unrecognized value — RESEND is the
    // deliberate, production-safe default (see the constants file's own
    // doc comment).
    return this.resendEmailClientAdapter.send(message);
  }
}
