import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RESEND_PLATFORM_SETTING_KEYS } from '../constants/resend-settings.constants';
import { emailDeliveryDisabled } from '../errors/email-delivery-disabled.error';
import { emailDeliveryMisconfigured } from '../errors/email-delivery-misconfigured.error';
import {
  EmailClientPort,
  OutboundEmailMessage,
} from '../ports/email-client.port';

const DEFAULT_FROM_NAME = 'GoService';

/**
 * Wraps the Resend SDK. Runs inside `EmailQueueProcessor` (a BullMQ
 * worker), never inline in a GraphQL request — see `EmailModule`.
 *
 * Reads `api-key`/`from-address`/`from-name` LIVE from `PlatformSettingPort`
 * on every `send()` call (GOS-3x follow-up, 2026-08-10) rather than once at
 * construction time via `ConfigService` — a config value cached at boot
 * could never reflect an admin rotating the key or switching providers
 * later. Mirrors how `JoseSocialIdentityValidationAdapter` already resolves
 * its own operator-configured value per-call. The `Resend` client itself is
 * therefore built fresh inside `send()`, not cached as an instance field.
 */
@Injectable()
export class ResendEmailClientAdapter implements EmailClientPort {
  private readonly logger = new Logger(ResendEmailClientAdapter.name);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async send(message: OutboundEmailMessage): Promise<void> {
    const [rawEnabled, apiKey, fromAddress, fromName] = await Promise.all([
      this.platformSettingPort.getValue(RESEND_PLATFORM_SETTING_KEYS.enabled),
      this.platformSettingPort.getValue(RESEND_PLATFORM_SETTING_KEYS.apiKey),
      this.platformSettingPort.getValue(
        RESEND_PLATFORM_SETTING_KEYS.fromAddress,
      ),
      this.platformSettingPort.getValue(RESEND_PLATFORM_SETTING_KEYS.fromName),
    ]);

    // Defense-in-depth only — the real gate is
    // `EnsureEmailDeliveryAvailableService`, called upfront by every
    // GraphQL-facing service (`register`/`resendVerificationCode`/
    // `requestPasswordReset`) BEFORE a job is even enqueued. If a job
    // somehow still reaches this worker (e.g. disabled/misconfigured
    // between enqueue and processing, a stale queued job from before a
    // provider was turned off), fail LOUDLY rather than silently dropping
    // the email — so the BullMQ job failure/retry is visible, same "never
    // silently proceed with a missing credential" philosophy as
    // `PlatformSettingPort.getValue`'s own doc comment.
    if (rawEnabled !== 'true') {
      throw emailDeliveryDisabled();
    }
    if (!apiKey || !fromAddress) {
      throw emailDeliveryMisconfigured();
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `${fromName ?? DEFAULT_FROM_NAME} <${fromAddress}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) {
      // Never log `message.text`/`message.html` — may contain a plaintext
      // verification code. Only a one-way correlation hash of `to`, same
      // discipline the old logging stub used.
      this.logger.warn({
        event: 'resend_send_failed',
        correlationId: this.correlationHash(message.to),
        errorName: error.name,
        errorMessage: error.message,
      });
      // Rethrow so the BullMQ `Worker` running `EmailQueueProcessor.process`
      // sees this job as failed and applies its retry/backoff policy.
      throw new Error(`Resend send failed: ${error.name} - ${error.message}`);
    }
  }

  private correlationHash(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex')
      .slice(0, 12);
  }
}
