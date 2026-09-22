import { LedgerEntry } from '@prisma/client';
import { AdminLedgerEntryModel } from './admin-ledger-entry.model';

/** Maps a raw `LedgerEntry` row (as returned by `LedgerRepository`) to the
 * GraphQL-facing `AdminLedgerEntryModel` — a straight 1:1 field copy, same
 * "nothing redacted for the admin audience" posture as
 * `toAdminReviewModel`. */
export function toAdminLedgerEntryModel(
  row: LedgerEntry,
): AdminLedgerEntryModel {
  const model = new AdminLedgerEntryModel();
  model.id = row.id;
  model.receiptNumber = row.receiptNumber;
  model.type = row.type;
  model.amount = row.amount;
  model.currency = row.currency;
  model.engagementId = row.engagementId;
  model.customerProfileId = row.customerProfileId;
  model.professionalProfileId = row.professionalProfileId;
  model.commissionPercentApplied = row.commissionPercentApplied;
  model.createdAt = row.createdAt;
  return model;
}
