import { CashPaymentConfirmation } from '@prisma/client';
import { AdminCashPaymentConfirmationModel } from './admin-cash-payment-confirmation.model';

/** Maps a raw `CashPaymentConfirmation` row (as returned by
 * `CashPaymentRepository`) to the GraphQL-facing
 * `AdminCashPaymentConfirmationModel` — a straight 1:1 field copy, same
 * "nothing redacted for the admin audience" posture as
 * `toAdminLedgerEntryModel`. */
export function toAdminCashPaymentConfirmationModel(
  row: CashPaymentConfirmation,
): AdminCashPaymentConfirmationModel {
  const model = new AdminCashPaymentConfirmationModel();
  model.id = row.id;
  model.engagementId = row.engagementId;
  model.customerConfirmedAt = row.customerConfirmedAt;
  model.professionalConfirmedAt = row.professionalConfirmedAt;
  model.commissionDebtRecorded = row.commissionDebtRecorded;
  model.createdAt = row.createdAt;
  return model;
}
