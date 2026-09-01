import { Injectable } from '@nestjs/common';
import { EmailTemplatePort } from '../ports/email-template.port';
import { EmailTemplatesRepository } from '../email-templates.repository';

/**
 * The only `EmailTemplatePort` implementation. Reuses
 * `EmailTemplatesRepository` (the sole owner of the `EmailTemplate` table)
 * rather than querying Prisma directly — mirrors
 * `PrismaPlatformSettingAdapter` exactly.
 */
@Injectable()
export class PrismaEmailTemplateAdapter implements EmailTemplatePort {
  constructor(
    private readonly emailTemplatesRepository: EmailTemplatesRepository,
  ) {}

  async getByKey(
    key: string,
  ): Promise<{ subject: string; htmlBody: string; textBody: string } | null> {
    const row = await this.emailTemplatesRepository.findByKey(key);
    if (!row) {
      return null;
    }
    return {
      subject: row.subject,
      htmlBody: row.htmlBody,
      textBody: row.textBody,
    };
  }
}
