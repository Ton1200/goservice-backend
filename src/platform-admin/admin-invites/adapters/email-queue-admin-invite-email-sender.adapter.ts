import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { buildAdminInviteEmail } from '../../../email/templates/admin-invite.template';
import { EmailQueueService } from '../../../email/queue/email-queue.service';
import { AdminInviteEmailSenderPort } from '../ports/admin-invite-email-sender.port';

/**
 * Real delivery of admin-invite emails, via the shared email queue
 * (`EmailModule`) — mirrors
 * `EmailQueuePasswordResetEmailSenderAdapter` exactly. `EmailQueueService.
 * enqueueEmail`'s `metadata.kind` accepts any free-form string, so no change
 * to `src/email/` itself was needed to add `'admin_invite'` here.
 */
@Injectable()
export class EmailQueueAdminInviteEmailSenderAdapter implements AdminInviteEmailSenderPort {
  constructor(
    private readonly emailQueueService: EmailQueueService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async sendAdminInvite(email: string, rawToken: string): Promise<void> {
    const { ttlHours } = this.configService.get('adminInvite', {
      infer: true,
    });
    const adminPanelPublicUrl = this.configService.get('adminPanelPublicUrl', {
      infer: true,
    });
    const inviteLink = `${adminPanelPublicUrl}?invite=${encodeURIComponent(rawToken)}`;

    const { subject, text, html } = buildAdminInviteEmail(inviteLink, ttlHours);
    await this.emailQueueService.enqueueEmail({
      to: email,
      subject,
      text,
      html,
      metadata: { kind: 'admin_invite' },
    });
  }
}
