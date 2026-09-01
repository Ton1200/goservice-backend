import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { EmailTemplateModel } from './models/email-template.model';
import { UpdateEmailTemplateInput } from './models/update-email-template.input';
import { EmailLayoutModel } from './models/email-layout.model';
import { UpdateEmailLayoutInput } from './models/update-email-layout.input';
import { EmailLogoUploadUrlModel } from './models/email-logo-upload-url.model';
import { RequestEmailLogoUploadUrlInput } from './models/request-email-logo-upload-url.input';
import { ListEmailTemplatesService } from './services/list-email-templates.service';
import { UpdateEmailTemplateService } from './services/update-email-template.service';
import { SendTestEmailTemplateService } from './services/send-test-email-template.service';
import { GetEmailLayoutService } from './services/get-email-layout.service';
import { UpdateEmailLayoutService } from './services/update-email-layout.service';
import { RequestEmailLogoUploadUrlService } from './services/request-email-logo-upload-url.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `emailTemplates`/`emailLayout` (read) require `EMAIL_TEMPLATES_READ`;
 * `updateEmailTemplate`/`sendTestEmailTemplate`/`updateEmailLayout` (write —
 * a test send IS a write-adjacent, real-side-effect action, not a read) all
 * require `EMAIL_TEMPLATES_WRITE`, mirroring `PlatformSettingsResolver`'s
 * own read/write split.
 *
 * Shared header/footer follow-up (2026-08-25): `emailLayout`/
 * `updateEmailLayout` are added to this SAME resolver (not a new one) and
 * reuse the SAME `Permission.EMAIL_TEMPLATES_READ`/`_WRITE` values — see
 * `EmailLayout`'s own header comment in `prisma/schema.prisma` for why
 * managing the shared layout is the same admin capability as managing the
 * templates it wraps, not a separate permission.
 *
 * Uploadable-logo follow-up (same day): `requestEmailLogoUploadUrl` is
 * ALSO added here (not a new resolver), gated by the SAME
 * `EMAIL_TEMPLATES_WRITE` permission as `updateEmailLayout` — requesting a
 * signed upload slot for the shared logo is the same admin capability as
 * editing the layout it becomes part of. No `@CurrentAdminUser()` — like
 * `sendTestEmailTemplate` above, nothing about this call is itself
 * persisted/attributed (the resulting `publicUrl` is only durably recorded
 * once the admin separately calls `updateEmailLayout`, which IS attributed).
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminEmailTemplatesResolver {
  constructor(
    private readonly listEmailTemplatesService: ListEmailTemplatesService,
    private readonly updateEmailTemplateService: UpdateEmailTemplateService,
    private readonly sendTestEmailTemplateService: SendTestEmailTemplateService,
    private readonly getEmailLayoutService: GetEmailLayoutService,
    private readonly updateEmailLayoutService: UpdateEmailLayoutService,
    private readonly requestEmailLogoUploadUrlService: RequestEmailLogoUploadUrlService,
  ) {}

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_READ)
  @Query(() => [EmailTemplateModel], {
    description:
      'Lists the 3 fixed transactional-email templates (verification_code, password_reset_code, admin_invite).',
  })
  emailTemplates(): Promise<EmailTemplateModel[]> {
    return this.listEmailTemplatesService.listEmailTemplates();
  }

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_WRITE)
  @Mutation(() => EmailTemplateModel, {
    description:
      'Updates one email template by key (subject/HTML body/text body), writing an AdminAuditLog row in the same transaction.',
  })
  updateEmailTemplate(
    @CurrentAdminUser() adminUserId: string,
    @Args('key') key: string,
    @Args('input') input: UpdateEmailTemplateInput,
  ): Promise<EmailTemplateModel> {
    return this.updateEmailTemplateService.updateEmailTemplate(
      adminUserId,
      key,
      input,
    );
  }

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_WRITE)
  @Mutation(() => Boolean, {
    description:
      'Sends a real test email for one template, rendered with sample variable values, to the given address — goes through the SAME Resend/Mailpit routing every other email in this codebase uses.',
  })
  sendTestEmailTemplate(
    @Args('key') key: string,
    @Args('to') to: string,
  ): Promise<boolean> {
    // No `@CurrentAdminUser()` here — unlike `updateEmailTemplate`, a test
    // send has no persisted state to attribute (`SendTestEmailTemplateService`
    // takes no `adminUserId`; nothing about a test send is written to
    // `AdminAuditLog`). `AdminSessionGuard`/`AdminPermissionsGuard` above
    // still fully gate WHO may call this — only WHAT gets recorded differs.
    return this.sendTestEmailTemplateService.sendTestEmailTemplate(key, to);
  }

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_READ)
  @Query(() => EmailLayoutModel, {
    description:
      'The single, shared email header/footer layout, applied automatically to every EmailTemplate.',
  })
  emailLayout(): Promise<EmailLayoutModel> {
    return this.getEmailLayoutService.getEmailLayout();
  }

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_WRITE)
  @Mutation(() => EmailLayoutModel, {
    description:
      'Updates the shared email header/footer layout, writing an AdminAuditLog row in the same transaction.',
  })
  updateEmailLayout(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: UpdateEmailLayoutInput,
  ): Promise<EmailLayoutModel> {
    return this.updateEmailLayoutService.updateEmailLayout(adminUserId, input);
  }

  @RequireAdminPermissions(Permission.EMAIL_TEMPLATES_WRITE)
  @Mutation(() => EmailLogoUploadUrlModel, {
    description:
      'Requests a signed upload URL for the shared email logo (image only). The caller PUTs the file to uploadUrl, then persists publicUrl via updateEmailLayout(logoUrl:).',
  })
  requestEmailLogoUploadUrl(
    @Args('input') input: RequestEmailLogoUploadUrlInput,
  ): Promise<EmailLogoUploadUrlModel> {
    return this.requestEmailLogoUploadUrlService.requestUploadUrl(input);
  }
}
