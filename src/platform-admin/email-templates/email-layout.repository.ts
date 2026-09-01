import { Injectable } from '@nestjs/common';
import { EmailLayout, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const EMAIL_LAYOUT_SINGLETON_ID = 'singleton';

export type EmailLayoutWithUpdatedBy = EmailLayout & {
  updatedByAdminUser: { displayName: string } | null;
};

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `EmailLayout` — same data-ownership rule as every other `*Repository` in
 * this codebase (sibling of, and mirrors, `EmailTemplatesRepository`).
 *
 * Every method targets the single `id: 'singleton'` row — `EmailLayout` has
 * exactly one row, ever (see that model's own header comment in
 * `prisma/schema.prisma`).
 */
@Injectable()
export class EmailLayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** For `EmailLayoutPort.getLayout` (the read-only cross-module port
   * `EmailTemplateRenderer` depends on) and for the admin-facing
   * `emailLayout` query. Returns `null` if `prisma/seed.ts` hasn't run yet
   * on this environment. */
  get(): Promise<EmailLayoutWithUpdatedBy | null> {
    return this.prisma.emailLayout.findUnique({
      where: { id: EMAIL_LAYOUT_SINGLETON_ID },
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }

  /**
   * Runs INSIDE the caller's own `$transaction` (`UpdateEmailLayoutService`)
   * — same pattern as `EmailTemplatesRepository.updateByKey`: the layout
   * write and the `AdminAuditLog` write commit atomically or not at all. An
   * `upsert`, not a plain `update` — UNLIKE `EmailTemplatesRepository`, the
   * `'singleton'` row may not exist yet on a not-yet-seeded environment, and
   * an admin should still be able to create it via `updateEmailLayout` for
   * the very first time rather than being blocked by a
   * `EMAIL_LAYOUT_ROW_NOT_SEEDED`-style pre-check.
   */
  upsert(
    tx: Prisma.TransactionClient,
    data: {
      headerHtml: string;
      footerHtml: string;
      headerText: string;
      footerText: string;
      // Uploadable-logo follow-up (2026-08-25) — `null` clears it (the
      // singleton row's `logoUrl` column is nullable), same "full-state
      // field, not a partial patch" convention as every other field on this
      // input.
      logoUrl: string | null;
      updatedByAdminUserId: string;
    },
  ): Promise<EmailLayoutWithUpdatedBy> {
    return tx.emailLayout.upsert({
      where: { id: EMAIL_LAYOUT_SINGLETON_ID },
      update: data,
      create: { id: EMAIL_LAYOUT_SINGLETON_ID, ...data },
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }
}
