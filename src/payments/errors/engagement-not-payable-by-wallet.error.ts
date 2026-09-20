import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_PAYABLE_BY_WALLET_CODE =
  'ENGAGEMENT_NOT_PAYABLE_BY_WALLET';

/**
 * Thrown by `StartEngagementWalletPaymentService` when the Engagement is not
 * `IN_PROGRESS`, `PENDING_CUSTOMER_CONFIRMATION` or `COMPLETED` (the SAME
 * window `engagementNotPayableByCard()` uses — a wallet payment is just
 * another digital method, not a separately-negotiated window), or when its
 * payment method was already fixed to CASH. ONE code for every disallowed
 * case, same "single precheck error" convention as the card flow's own.
 */
export function engagementNotPayableByWallet(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_PAYABLE_BY_WALLET_CODE,
    'This Engagement cannot be paid by Mercado Pago wallet right now.',
  );
}
