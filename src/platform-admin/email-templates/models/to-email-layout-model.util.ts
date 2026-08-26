import { EmailLayoutModel } from './email-layout.model';
import type { EmailLayoutWithUpdatedBy } from '../email-layout.repository';

/**
 * The ONE place an `EmailLayout` Prisma row is mapped to the GraphQL-facing
 * `EmailLayoutModel` — shared by `GetEmailLayoutService` and
 * `UpdateEmailLayoutService` so there is exactly one mapping to keep
 * correct, not two that could drift. Mirrors `toEmailTemplateModel` exactly.
 */
export function toEmailLayoutModel(
  row: EmailLayoutWithUpdatedBy,
): EmailLayoutModel {
  const model = new EmailLayoutModel();
  model.id = row.id;
  model.headerHtml = row.headerHtml;
  model.footerHtml = row.footerHtml;
  model.headerText = row.headerText;
  model.footerText = row.footerText;
  model.logoUrl = row.logoUrl;
  model.updatedBy = row.updatedByAdminUser?.displayName ?? null;
  model.updatedAt = row.updatedAt;
  return model;
}
