import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppConfig } from '../../config/configuration';
import {
  EmailClientPort,
  OutboundEmailMessage,
} from '../ports/email-client.port';

const MAILPIT_FROM = 'GoService (local dev) <dev@localhost>';

/**
 * Delivers via SMTP to a local Mailpit container (`docker-compose.yml`'s
 * `mailpit` service) instead of Resend — a LOCAL-DEV-ONLY convenience so
 * outgoing email can be inspected in Mailpit's own web dashboard
 * (`http://localhost:8025` by default) without depending on a real Resend
 * account/recipient. Never reachable in production — see
 * `EmailProviderRouterAdapter`, the only thing that ever selects this
 * adapter, which refuses to do so when `NODE_ENV=production` regardless of
 * the `notifications.email.provider` `PlatformSetting`.
 *
 * Deliberately simpler than `ResendEmailClientAdapter`: no
 * enabled/api-key/from-address `PlatformSetting` lookups (Mailpit needs
 * none of that — it accepts any SMTP connection, unauthenticated, by
 * design), no retries-worthy provider-side error shape to unwrap. A fixed,
 * obviously-fake `from` address is used since Mailpit never actually
 * delivers anywhere — see `MAILPIT_FROM` above.
 */
@Injectable()
export class MailpitEmailClientAdapter implements EmailClientPort {
  private readonly logger = new Logger(MailpitEmailClientAdapter.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async send(message: OutboundEmailMessage): Promise<void> {
    const { smtpHost, smtpPort } = this.configService.get('mailpit', {
      infer: true,
    });

    // Built fresh per send, not cached as an instance field — mirrors
    // `ResendEmailClientAdapter`'s own reasoning, and keeps this adapter
    // trivially safe to unit-test without a shared mutable transport.
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false,
    });

    try {
      await transport.sendMail({
        from: MAILPIT_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      // Never log message.text/html — may contain a plaintext verification
      // code, same discipline as ResendEmailClientAdapter.
      const err = error as Error;
      this.logger.warn({
        event: 'mailpit_send_failed',
        correlationId: this.correlationHash(message.to),
        errorName: err.name,
        errorMessage: err.message,
      });
      // Rethrow so the BullMQ Worker running EmailQueueProcessor.process
      // sees this job as failed and applies its retry/backoff policy —
      // e.g. Mailpit's container isn't running locally.
      throw new Error(`Mailpit send failed: ${err.name} - ${err.message}`);
    }
  }

  private correlationHash(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex')
      .slice(0, 12);
  }
}
