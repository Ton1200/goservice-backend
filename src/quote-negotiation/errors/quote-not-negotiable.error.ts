import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_NOT_NEGOTIABLE_CODE = 'QUOTE_NOT_NEGOTIABLE';

/**
 * Thrown by `PostQuoteNegotiationMessageService`/
 * `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService` when
 * the target `Quote` is not `SENT` — the ticket's "ACCEPTED, DECLINED o
 * WITHDRAWN" blocks negotiation maps onto this codebase's real
 * `QuoteStatus` enum (no `DECLINED` value exists) as "not SENT":
 * `ACCEPTED`/`REJECTED`/`WITHDRAWN` all block further negotiation. NOT
 * anti-enumeration — same reasoning as `quoteNotSent()` (`quotes/errors/`):
 * the caller already knows this is a Quote they're a party to (see
 * `QuoteNegotiationAccessService.resolveParty`), so disclosing its current
 * status leaks nothing new.
 */
export function quoteNotNegotiable(): DomainException {
  return new DomainException(
    QUOTE_NOT_NEGOTIABLE_CODE,
    'This Quote is no longer negotiable — it is not SENT.',
  );
}
