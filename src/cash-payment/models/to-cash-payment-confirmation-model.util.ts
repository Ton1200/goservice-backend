import { PaymentAttempt, PaymentAttemptStatus } from '@prisma/client';
import { CashPaymentConfirmationModel } from './cash-payment-confirmation.model';

/**
 * Maps the cash `PaymentAttempt` row `ConfirmCashPaymentService` returns onto
 * `confirmCashPayment`'s own, unchanged GraphQL return shape — kept stable
 * across the 2026-09-18 generalization (cash used to be its own
 * `CashPaymentConfirmation` row) so this mutation's contract never moved.
 * `commissionDebtRecorded` is derived: recording the debt and flipping the
 * attempt APPROVED happen in the very same statement (see
 * `ConfirmCashPaymentService`), so the two are equivalent facts about the
 * same row.
 */
export function toCashPaymentConfirmationModel(
  attempt: PaymentAttempt,
): CashPaymentConfirmationModel {
  const model = new CashPaymentConfirmationModel();
  model.id = attempt.id;
  model.engagementId = attempt.engagementId;
  model.customerConfirmedAt = attempt.customerConfirmedAt;
  model.professionalConfirmedAt = attempt.professionalConfirmedAt;
  model.commissionDebtRecorded =
    attempt.status === PaymentAttemptStatus.APPROVED;
  model.createdAt = attempt.createdAt;
  return model;
}
