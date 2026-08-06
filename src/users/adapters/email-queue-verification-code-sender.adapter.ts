import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { buildVerificationCodeEmail } from '../../email/templates/verification-code.template';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';

/**
 * Real delivery of verification-code emails, via the shared email queue
 * (`EmailModule`). Named for what it actually does — enqueue, never call
 * the Resend API in-request — rather than `ResendVerificationCodeSenderAdapter`,
 * which would collide semantically with the unrelated `resendVerificationCode`
 * mutation/`ResendVerificationCodeService` (the verb "resend" of that
 * feature, not the "Resend" email provider).
 */
@Injectable()
export class EmailQueueVerificationCodeSenderAdapter implements VerificationCodeSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendVerificationCode(email: string, code: string): Promise<void> {
    const { codeTtlMinutes } = this.configService.get('emailVerification', {
      infer: true,
    });
    const { subject, text, html } = buildVerificationCodeEmail(
      code,
      codeTtlMinutes,
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
