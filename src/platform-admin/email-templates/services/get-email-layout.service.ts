import { Injectable } from '@nestjs/common';
import { EmailLayoutRepository } from '../email-layout.repository';
import { EmailLayoutModel } from '../models/email-layout.model';
import { toEmailLayoutModel } from '../models/to-email-layout-model.util';
import { emailLayoutRowNotSeeded } from '../errors/email-layout.errors';

/**
 * Thin application service wrapping `EmailLayoutRepository.get()` and
 * mapping to the GraphQL-facing model, backing the `emailLayout` query —
 * mirrors `ListEmailTemplatesService`'s own shape, except this reads a
 * single row instead of a list (see `EmailLayout`'s own singleton-model
 * header comment).
 */
@Injectable()
export class GetEmailLayoutService {
  constructor(private readonly emailLayoutRepository: EmailLayoutRepository) {}

  async getEmailLayout(): Promise<EmailLayoutModel> {
    const row = await this.emailLayoutRepository.get();
    if (!row) {
      throw emailLayoutRowNotSeeded();
    }
    return toEmailLayoutModel(row);
  }
}
