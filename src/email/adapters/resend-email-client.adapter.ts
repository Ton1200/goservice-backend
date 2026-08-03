import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { AppConfig } from '../../config/configuration';
import {
  EmailClientPort,
  OutboundEmailMessage,
} from '../ports/email-client.port';

/**
 * Wraps the Resend SDK. Runs inside `EmailQueueProcessor` (a BullMQ
 * worker), never inline in a GraphQL request — see `EmailModule`.
 */
@Injectable()
export class ResendEmailClientAdapter implements EmailClientPort {
  private readonly logger = new Logger(ResendEmailClientAdapter.name);
  private readonly resend: Resend;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    const { resendApiKey } = this.configService.get('email', {
      infer: true,
    });
    this.resend = new Resend(resendApiKey);
  }

  async send(message: OutboundEmailMessage): Promise<void> {
    const { fromAddress, fromName } = this.configService.get('email', {
      infer: true,
    });
    const { error } = await this.resend.emails.send({
      from: `${fromName} <${fromAddress}>`,
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
