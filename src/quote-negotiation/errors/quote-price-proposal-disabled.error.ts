import { QuoteNegotiationParty } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_PRICE_PROPOSAL_DISABLED_FOR_CUSTOMER_CODE =
  'QUOTE_PRICE_PROPOSAL_DISABLED_FOR_CUSTOMER';
const QUOTE_PRICE_PROPOSAL_DISABLED_FOR_PROFESSIONAL_CODE =
  'QUOTE_PRICE_PROPOSAL_DISABLED_FOR_PROFESSIONAL';

/**
 * Thrown by `PostQuoteNegotiationMessageService` when the caller submitted
 * a `proposedPrice` but the role-specific
 * `quote-negotiation.price-edit.customer-can-propose`/
 * `.professional-can-propose` flag is currently off for THEIR role. One
 * factory, parameterized by role, returning one of two distinct codes — the
 * price is NEVER silently dropped in this case (per the AC): the whole
 * mutation fails explicitly instead, so the client can surface a real error
 * rather than posting a comment that silently lost its price.
 */
export function quotePriceProposalDisabled(
  role: QuoteNegotiationParty,
): DomainException {
  if (role === QuoteNegotiationParty.CUSTOMER) {
    return new DomainException(
      QUOTE_PRICE_PROPOSAL_DISABLED_FOR_CUSTOMER_CODE,
      'Customers are not currently allowed to propose a price in Quote Negotiation.',
    );
  }
  return new DomainException(
    QUOTE_PRICE_PROPOSAL_DISABLED_FOR_PROFESSIONAL_CODE,
    'Professionals are not currently allowed to propose a price in Quote Negotiation.',
  );
}
