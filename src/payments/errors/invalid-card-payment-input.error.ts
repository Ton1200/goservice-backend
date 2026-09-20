import { DomainException } from '../../common/errors/domain-exception';

const INVALID_CARD_PAYMENT_INPUT_CODE = 'INVALID_CARD_PAYMENT_INPUT';

/**
 * Thrown for a structurally invalid `payEngagementWithCard` argument (blank
 * token/brand, non-positive installments) BEFORE any attempt row is created
 * or the provider is contacted.
 */
export function invalidCardPaymentInput(): DomainException {
  return new DomainException(
    INVALID_CARD_PAYMENT_INPUT_CODE,
    'Invalid card payment input.',
  );
}
