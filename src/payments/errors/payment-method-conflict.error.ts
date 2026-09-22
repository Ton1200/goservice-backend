import { DomainException } from '../../common/errors/domain-exception';

const PAYMENT_METHOD_CONFLICT_CODE = 'PAYMENT_METHOD_CONFLICT';

/**
 * Thrown when an Engagement is already committed to the OTHER payment
 * method — a Customer tries to pay by card an Engagement whose
 * `paymentMethod` is already `CASH` (or vice versa: confirm cash on one
 * already `MERCADOPAGO`). Same reasoning as `cardPaymentAlreadyInProgress()`,
 * one level up: that error covers a SECOND attempt of the SAME method; this
 * one covers a conflicting DIFFERENT method. Both are ultimately backstopped
 * by the same partial unique index on `PaymentAttempt` (at most one
 * PENDING/APPROVED row per Engagement, whatever its method) — this is the
 * precondition check that gives a clear domain error instead of a raw
 * unique-constraint failure for the common case; the index itself is what
 * makes it hold under a race.
 */
export function paymentMethodConflict(): DomainException {
  return new DomainException(
    PAYMENT_METHOD_CONFLICT_CODE,
    'This Engagement is already using a different payment method.',
  );
}
