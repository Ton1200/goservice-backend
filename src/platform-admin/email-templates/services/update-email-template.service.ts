import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { EmailTemplatesRepository } from '../email-templates.repository';
import { isKnownEmailTemplateKey } from '../known-email-template-keys.constant';
import {
  emailTemplateRowNotSeeded,
  unknownEmailTemplateKey,
} from '../errors/email-template.errors';
import { UpdateEmailTemplateInput } from '../models/update-email-template.input';
import { EmailTemplateModel } from '../models/email-template.model';
import { toEmailTemplateModel } from '../models/to-email-template-model.util';

/**
 * Orchestrates `updateEmailTemplate`: validates `key` is one of the 3 known
 * keys FIRST (`UNKNOWN_EMAIL_TEMPLATE_KEY`), then that a row already exists
 * for it (`EMAIL_TEMPLATE_ROW_NOT_SEEDED` — same "pre-check, then friendly
 * error" convention `UpdateCategoryService` already establishes for its own
 * `CATEGORY_NOT_FOUND`), then updates the row AND writes an `AdminAuditLog`
 * row — all in the SAME `$transaction`, mirroring
 * `SetPlatformSettingService` exactly.
 */
@Injectable()
export class UpdateEmailTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailTemplatesRepository: EmailTemplatesRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateEmailTemplate(
    adminUserId: string,
    key: string,
    input: UpdateEmailTemplateInput,
  ): Promise<EmailTemplateModel> {
    if (!isKnownEmailTemplateKey(key)) {
      throw unknownEmailTemplateKey(key);
    }

    const existing = await this.emailTemplatesRepository.findByKey(key);
    if (!existing) {
      throw emailTemplateRowNotSeeded(key);
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await this.emailTemplatesRepository.updateByKey(tx, key, {
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody,
        updatedByAdminUserId: adminUserId,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'EMAIL_TEMPLATE_UPDATED',
        targetType: 'EmailTemplate',
        targetKey: key,
        // Never sensitive — this row holds no secret/PII, unlike
        // `PlatformSetting`'s own encrypted-row metadata restraint. The
        // full new subject is small and useful audit context; the bodies
        // themselves are intentionally left OUT of the audit metadata (they
        // can be arbitrarily long — see `UpdateEmailTemplateInput`'s own
        // max-length comment — and the row itself, plus this same audit
        // trail's `occurredAt`, is already the durable record of what
        // changed).
        metadata: { subject: input.subject },
      });

      return toEmailTemplateModel(row);
    });
  }
}
