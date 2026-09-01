import { Injectable } from '@nestjs/common';
import { EmailTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type EmailTemplateWithUpdatedBy = EmailTemplate & {
  updatedByAdminUser: { displayName: string } | null;
};

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `EmailTemplate` — same data-ownership rule as every other `*Repository`
 * in this codebase (see `PlatformSettingsRepository` for the closest
 * precedent this mirrors).
 */
@Injectable()
export class EmailTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** For the admin-facing `emailTemplates` query — joins the updating
   * admin's `displayName` so `ListEmailTemplatesService` doesn't need a
   * second round trip. */
  findAll(): Promise<EmailTemplateWithUpdatedBy[]> {
    return this.prisma.emailTemplate.findMany({
      orderBy: { key: 'asc' },
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }

  /** For `EmailTemplatePort.getByKey` (the read-only cross-module port every
   * sender adapter depends on) and for `UpdateEmailTemplateService`'s own
   * pre-write existence check. */
  findByKey(key: string): Promise<EmailTemplate | null> {
    return this.prisma.emailTemplate.findUnique({ where: { key } });
  }

  /**
   * Runs INSIDE the caller's own `$transaction` (`UpdateEmailTemplateService`)
   * — same pattern as `PlatformSettingsRepository.upsert`: the template write
   * and the `AdminAuditLog` write commit atomically or not at all. A plain
   * `update`, not an `upsert` — `EmailTemplate` rows are never created via
   * GraphQL (see this model's own header comment in `prisma/schema.prisma`),
   * only ever seeded once and then updated.
   */
  updateByKey(
    tx: Prisma.TransactionClient,
    key: string,
    data: {
      subject: string;
      htmlBody: string;
      textBody: string;
      updatedByAdminUserId: string;
    },
  ): Promise<EmailTemplateWithUpdatedBy> {
    return tx.emailTemplate.update({
      where: { key },
      data,
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }
}
