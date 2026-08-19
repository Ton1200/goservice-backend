import { DomainException } from '../../common/errors/domain-exception';

const INVALID_QUOTE_PRICE_CODE = 'INVALID_QUOTE_PRICE';

/**
 * Thrown by `SubmitQuoteService` when `price <= 0`. A reasonable technical
 * default, NOT a confirmed product rule — no minimum-price/currency
 * convention is documented anywhere in this project for Quotes (see the
 * GOS-41 plan's decision #9 and "Decisiones pendientes"). Checked in the
 * application service (not only via a DTO decorator) specifically so this
 * exact, disclosable `extensions.code` is what the GraphQL client sees.
 */
export function invalidQuotePrice(): DomainException {
  return new DomainException(
    INVALID_QUOTE_PRICE_CODE,
    'price must be greater than 0.',
  );
}
