import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { EmailLayoutRepository } from '../email-layout.repository';
import { UpdateEmailLayoutInput } from '../models/update-email-layout.input';
import { EmailLayoutModel } from '../models/email-layout.model';
import { toEmailLayoutModel } from '../models/to-email-layout-model.util';

/**
 * Orchestrates `updateEmailLayout`: upserts the single `EmailLayout`
 * `'singleton'` row AND writes an `AdminAuditLog` row — both in the SAME
 * `$transaction`, mirroring `UpdateEmailTemplateService` exactly. Unlike
 * that service, there is no `unknownEmailTemplateKey`/`...RowNotSeeded`
 * pre-check here: `EmailLayoutRepository.upsert` creates the row on first
 * use if it doesn't exist yet (see that repository's own header comment),
 * since there is no "key" to validate — the layout is a true singleton.
 */
@Injectable()
export class UpdateEmailLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailLayoutRepository: EmailLayoutRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateEmailLayout(
    adminUserId: string,
    input: UpdateEmailLayoutInput,
  ): Promise<EmailLayoutModel> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.emailLayoutRepository.upsert(tx, {
        headerHtml: input.headerHtml,
        footerHtml: input.footerHtml,
        headerText: input.headerText,
        footerText: input.footerText,
        // `?? null` — `input.logoUrl` is `undefined` only if the caller
        // omits the field entirely; the admin panel never does that (it
        // always resubmits the current value), but this keeps the write
        // well-defined (never `undefined` reaching Prisma) either way. See
        // `UpdateEmailLayoutInput.logoUrl`'s own header comment for the
        // "full-state field, not a partial patch" convention this follows.
        logoUrl: input.logoUrl ?? null,
        updatedByAdminUserId: adminUserId,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'EMAIL_LAYOUT_UPDATED',
        targetType: 'EmailLayout',
        targetKey: 'singleton',
        // Never sensitive — same reasoning as `UpdateEmailTemplateService`'s
        // own audit metadata: the bodies themselves are deliberately left
        // OUT (they can be arbitrarily long), the row itself plus this audit
        // trail's `occurredAt` is already the durable record of what
        // changed.
        metadata: {
          headerHtmlLength: input.headerHtml.length,
          footerHtmlLength: input.footerHtml.length,
        },
      });

      return toEmailLayoutModel(row);
    });
  }
}
