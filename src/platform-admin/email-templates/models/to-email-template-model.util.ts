import { EmailTemplateModel } from './email-template.model';
import type { EmailTemplateWithUpdatedBy } from '../email-templates.repository';

/**
 * The ONE place an `EmailTemplate` Prisma row is mapped to the
 * GraphQL-facing `EmailTemplateModel` — shared by `ListEmailTemplatesService`
 * and `UpdateEmailTemplateService` so there is exactly one mapping to keep
 * correct, not two that could drift. Mirrors `toPlatformSettingModel`
 * exactly.
 */
export function toEmailTemplateModel(
  row: EmailTemplateWithUpdatedBy,
): EmailTemplateModel {
  const model = new EmailTemplateModel();
  model.id = row.id;
  model.key = row.key;
  model.subject = row.subject;
  model.htmlBody = row.htmlBody;
  model.textBody = row.textBody;
  model.updatedBy = row.updatedByAdminUser?.displayName ?? null;
  model.updatedAt = row.updatedAt;
  return model;
}
