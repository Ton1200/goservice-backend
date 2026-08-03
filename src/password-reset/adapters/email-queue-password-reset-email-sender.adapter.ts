import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { buildPasswordResetCodeEmail } from '../../email/templates/password-reset-code.template';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';

/**
 * Real delivery of password-reset-code emails, via the shared email queue
 * (`EmailModule`) — mirrors
 * `src/users/adapters/email-queue-verification-code-sender.adapter.ts`
 * exactly, including its naming rationale (named for what it does —
 * enqueue — not for the "Resend" email provider).
 */
@Injectable()
export class EmailQueuePasswordResetEmailSenderAdapter implements PasswordResetEmailSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    const { codeTtlMinutes } = this.configService.get('passwordReset', {
      infer: true,
    });
    const { subject, text, html } = buildPasswordResetCodeEmail(
      code,
      codeTtlMinutes,
    );
    await this.emailQueueService.enqueueEmail({
      to: email,
      subject,
      text,
      html,
      metadata: { kind: 'password_reset_code' },
    });
  }
}
