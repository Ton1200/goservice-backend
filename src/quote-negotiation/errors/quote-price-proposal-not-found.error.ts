import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_PRICE_PROPOSAL_NOT_FOUND_CODE = 'QUOTE_PRICE_PROPOSAL_NOT_FOUND';

/**
 * Thrown for ANY case where a `QuotePriceProposal` id either does not exist
 * AT ALL, or exists but the caller is not a party to its owning `Quote` —
 * deliberately the SAME code for both cases, same anti-enumeration
 * discipline as `quotes/errors/quote-not-found.error.ts`'s own
 * `quoteNotFound()`.
 */
export function quotePriceProposalNotFound(): DomainException {
  return new DomainException(
    QUOTE_PRICE_PROPOSAL_NOT_FOUND_CODE,
    'Quote price proposal not found.',
  );
}
