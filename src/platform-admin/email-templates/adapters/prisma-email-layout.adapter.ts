import { Injectable } from '@nestjs/common';
import { EmailLayoutPort } from '../ports/email-layout.port';
import { EmailLayoutRepository } from '../email-layout.repository';

/**
 * The only `EmailLayoutPort` implementation. Reuses `EmailLayoutRepository`
 * (the sole owner of the `EmailLayout` table) rather than querying Prisma
 * directly — mirrors `PrismaEmailTemplateAdapter` exactly.
 */
@Injectable()
export class PrismaEmailLayoutAdapter implements EmailLayoutPort {
  constructor(private readonly emailLayoutRepository: EmailLayoutRepository) {}

  async getLayout(): Promise<{
    headerHtml: string;
    footerHtml: string;
    headerText: string;
    footerText: string;
    logoUrl: string | null;
  } | null> {
    const row = await this.emailLayoutRepository.get();
    if (!row) {
      return null;
    }
    return {
      headerHtml: row.headerHtml,
      footerHtml: row.footerHtml,
      headerText: row.headerText,
      footerText: row.footerText,
      logoUrl: row.logoUrl,
    };
  }
}
