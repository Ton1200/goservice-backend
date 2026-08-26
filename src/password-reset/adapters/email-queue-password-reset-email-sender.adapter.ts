import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { EmailTemplateRenderer } from '../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';

const EMAIL_TEMPLATE_KEY = 'password_reset_code';

/**
 * Real delivery of password-reset-code emails, via the shared email queue
 * (`EmailModule`) — mirrors
 * `src/users/adapters/email-queue-verification-code-sender.adapter.ts`
 * exactly, including its naming rationale (named for what it does —
 * enqueue — not for the "Resend" email provider), its editable-template
 * rendering (2026-08-24 follow-up — `src/email/templates/password-reset-code.template.ts`
 * is DELETED), and its shared-header/footer rendering via
 * `EmailTemplateRenderer` (2026-08-25 follow-up — see that service's own
 * header comment).
 */
@Injectable()
export class EmailQueuePasswordResetEmailSenderAdapter implements PasswordResetEmailSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendPasswordResetCode(
    email: string,
    code: string,
    firstName: string | null,
  ): Promise<void> {
    const { codeTtlMinutes } = this.configService.get('passwordReset', {
      infer: true,
    });

    const greeting = firstName ? `Hola ${firstName},` : 'Hola,';
    const { subject, text, html } = await this.emailTemplateRenderer.render(
      EMAIL_TEMPLATE_KEY,
      {
        greeting,
        firstName: firstName ?? '',
        code,
        ttlMinutes: String(codeTtlMinutes),
      },
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
