import { PaymentAttempt } from '@prisma/client';
import { AdminPaymentAttemptModel } from './admin-payment-attempt.model';

/** Maps a raw `PaymentAttempt` row to the GraphQL-facing
 * `AdminPaymentAttemptModel` — a straight 1:1 field copy, nothing redacted
 * for the admin audience, same posture as `toAdminLedgerEntryModel`. */
export function toAdminPaymentAttemptModel(
  row: PaymentAttempt,
): AdminPaymentAttemptModel {
  const model = new AdminPaymentAttemptModel();
  model.id = row.id;
  model.engagementId = row.engagementId;
  model.method = row.method;
  model.type = row.type;
  model.status = row.status;
  model.amount = row.amount;
  model.currency = row.currency;
  model.installments = row.installments;
  model.rejectionReason = row.rejectionReason;
  model.providerPaymentId = row.providerPaymentId;
  model.cardBrand = row.cardBrand;
  model.cardLastFour = row.cardLastFour;
  model.providerFeeAmount = row.providerFeeAmount;
  model.providerTaxAmount = row.providerTaxAmount;
  model.netReceivedAmount = row.netReceivedAmount;
  model.customerConfirmedAt = row.customerConfirmedAt;
  model.professionalConfirmedAt = row.professionalConfirmedAt;
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}
