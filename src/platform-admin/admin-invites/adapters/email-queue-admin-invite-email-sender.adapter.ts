import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { EmailTemplateRenderer } from '../../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../../email/queue/email-queue.service';
import { AdminInviteEmailSenderPort } from '../ports/admin-invite-email-sender.port';

const EMAIL_TEMPLATE_KEY = 'admin_invite';

/**
 * Real delivery of admin-invite emails, via the shared email queue
 * (`EmailModule`) — mirrors `EmailQueuePasswordResetEmailSenderAdapter`
 * exactly, including its editable-template rendering (2026-08-24 follow-up
 * — `src/email/templates/admin-invite.template.ts` is DELETED) and its
 * shared-header/footer rendering via `EmailTemplateRenderer` (2026-08-25
 * follow-up — see that service's own header comment). `{{greeting}}` is
 * always `Hola ${displayName},` here — `AdminUser.displayName` is
 * required/non-null, unlike `User.firstName`, so there is no empty-name
 * branch to resolve.
 */
@Injectable()
export class EmailQueueAdminInviteEmailSenderAdapter implements AdminInviteEmailSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendAdminInvite(
    email: string,
    rawToken: string,
    displayName: string,
  ): Promise<void> {
    const { ttlHours } = this.configService.get('adminInvite', {
      infer: true,
    });
    const adminPanelPublicUrl = this.configService.get('adminPanelPublicUrl', {
      infer: true,
    });
    const inviteLink = `${adminPanelPublicUrl}?invite=${encodeURIComponent(rawToken)}`;

    const { subject, text, html } = await this.emailTemplateRenderer.render(
      EMAIL_TEMPLATE_KEY,
      {
        greeting: `Hola ${displayName},`,
        displayName,
        inviteLink,
        ttlHours: String(ttlHours),
      },
    );

    await this.emailQueueService.enqueueEmail({
      to: email,
      subject,
      text,
      html,
      metadata: { kind: 'admin_invite' },
    });
  }
}
