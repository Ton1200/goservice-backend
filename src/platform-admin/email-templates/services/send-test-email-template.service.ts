import { Injectable } from '@nestjs/common';
import { EmailTemplateRenderer } from '../../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../../email/queue/email-queue.service';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import {
  EMAIL_TEMPLATE_SAMPLE_VARIABLES,
  isKnownEmailTemplateKey,
} from '../known-email-template-keys.constant';
import { unknownEmailTemplateKey } from '../errors/email-template.errors';

/**
 * Orchestrates `sendTestEmailTemplate` — lets an admin verify a template's
 * current subject/HTML body/text body (WRAPPED in the shared, admin-editable
 * `EmailLayout` header/footer — see the follow-up note below) actually
 * renders and delivers, without needing a real User/AdminUser to trigger the
 * real flow. Calls `EnsureEmailDeliveryAvailableService.ensureAvailable()`
 * FIRST, same upfront gate every other email-sending mutation in this
 * codebase calls first (see that service's own header comment) — a test
 * send is still a real send, through the SAME `EmailQueueService`/
 * Resend-or-Mailpit routing every other email in this codebase goes through
 * (see `EmailProviderRouterAdapter`'s own header comment); nothing here
 * bypasses or duplicates that infrastructure.
 *
 * Renders with `EMAIL_TEMPLATE_SAMPLE_VARIABLES` (the same constant the
 * admin panel's edit-dialog hint text is derived from) — a realistic, but
 * clearly fake, set of variable values, so the admin can see exactly what a
 * real recipient would see.
 *
 * Shared header/footer follow-up (2026-08-25): rendering itself (template
 * body + the shared `EmailLayout`) is now delegated to
 * `EmailTemplateRenderer.render()`, exactly like every sender adapter — this
 * service no longer calls `EmailTemplatesRepository`/`renderEmailTemplate`
 * directly, so a test send is a faithful preview of what a real recipient
 * gets, header/footer included.
 */
@Injectable()
export class SendTestEmailTemplateService {
  constructor(
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
    private readonly emailTemplateRenderer: EmailTemplateRenderer,
    private readonly emailQueueService: EmailQueueService,
  ) {}

  async sendTestEmailTemplate(key: string, to: string): Promise<boolean> {
    // Checked FIRST, before even validating `key` — mirrors every other
    // email-sending mutation's own ordering precedent (see
    // `EnsureEmailDeliveryAvailableService`'s own doc comment): a global,
    // not-per-input gate.
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

    if (!isKnownEmailTemplateKey(key)) {
      throw unknownEmailTemplateKey(key);
    }

    const rendered = await this.emailTemplateRenderer.render(
      key,
      EMAIL_TEMPLATE_SAMPLE_VARIABLES[key],
    );

    await this.emailQueueService.enqueueEmail({
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      metadata: { kind: 'admin_template_test' },
    });

    return true;
  }
}
