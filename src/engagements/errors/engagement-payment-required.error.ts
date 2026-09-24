import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_PAYMENT_REQUIRED_CODE = 'ENGAGEMENT_PAYMENT_REQUIRED';

/**
 * GOS-123 — thrown by `ConfirmEngagementCompletionService` when the
 * Engagement has no `PaymentAttempt` in `APPROVED`: an approved digital
 * payment, or a cash payment confirmed by both parties
 * (`ConfirmCashPaymentService` flips it to `APPROVED`). The commission is
 * recorded when the payment is approved, so this rule is what guarantees a
 * `COMPLETED` Engagement always carries exactly one commission. Checked
 * AFTER the state check, so a wrong-state call still gets
 * `ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION`.
 */
export function engagementPaymentRequired(): DomainException {
  return new DomainException(
    ENGAGEMENT_PAYMENT_REQUIRED_CODE,
    'This Engagement has no approved payment yet — completion cannot be confirmed.',
  );
}
