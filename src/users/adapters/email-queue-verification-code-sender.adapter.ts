import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { EmailTemplateRenderer } from '../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';

const EMAIL_TEMPLATE_KEY = 'verification_code';

/**
 * Real delivery of verification-code emails, via the shared email queue
 * (`EmailModule`). Named for what it actually does — enqueue, never call
 * the Resend API in-request — rather than `ResendVerificationCodeSenderAdapter`,
 * which would collide semantically with the unrelated `resendVerificationCode`
 * mutation/`ResendVerificationCodeService` (the verb "resend" of that
 * feature, not the "Resend" email provider).
 *
 * Editable transactional-email templates follow-up (2026-08-24): the
 * subject/HTML body/text body are no longer hardcoded strings
 * (`src/email/templates/verification-code.template.ts`, DELETED) — they now
 * live in the `EmailTemplate` DB row keyed `verification_code`, admin-edited
 * via `updateEmailTemplate`. `{{greeting}}` is resolved HERE, not inside the
 * raw substitution util — `Hola ${firstName},` when a first name exists, or
 * the generic `Hola,` otherwise — so an admin editing the template never
 * has to special-case the empty-name branch themselves; they always just
 * use `{{greeting}}`.
 *
 * Shared header/footer follow-up (2026-08-25): rendering itself (template
 * body + the shared, admin-editable `EmailLayout` header/footer) is now
 * delegated to `EmailTemplateRenderer.render()` — this adapter no longer
 * calls `EmailTemplatePort`/`renderEmailTemplate` directly (see that
 * service's own header comment for the full composition contract,
 * including its fail-closed `emailTemplateNotConfigured`/
 * `emailLayoutNotConfigured` behavior when either the template or the
 * layout row is missing).
 */
@Injectable()
export class EmailQueueVerificationCodeSenderAdapter implements VerificationCodeSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendVerificationCode(
    email: string,
    code: string,
    firstName: string | null,
  ): Promise<void> {
    const { codeTtlMinutes } = this.configService.get('emailVerification', {
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
      metadata: { kind: 'verification_code' },
    });
  }
}
