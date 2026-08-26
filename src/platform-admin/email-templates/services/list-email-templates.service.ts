import { Injectable } from '@nestjs/common';
import { EmailTemplatesRepository } from '../email-templates.repository';
import { EmailTemplateModel } from '../models/email-template.model';
import { toEmailTemplateModel } from '../models/to-email-template-model.util';

/**
 * Thin application service wrapping `EmailTemplatesRepository.findAll()` and
 * mapping to the GraphQL-facing model — mirrors `ListPlatformSettingsService`
 * exactly.
 */
@Injectable()
export class ListEmailTemplatesService {
  constructor(
    private readonly emailTemplatesRepository: EmailTemplatesRepository,
  ) {}

  async listEmailTemplates(): Promise<EmailTemplateModel[]> {
    const rows = await this.emailTemplatesRepository.findAll();
    return rows.map((row) => toEmailTemplateModel(row));
  }
}
