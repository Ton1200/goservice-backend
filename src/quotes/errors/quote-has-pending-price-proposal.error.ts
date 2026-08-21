import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_HAS_PENDING_PRICE_PROPOSAL_CODE =
  'QUOTE_HAS_PENDING_PRICE_PROPOSAL';

/**
 * Thrown by `AcceptQuoteService`'s pre-read when the target `Quote`
 * (already confirmed `SENT` — see `quoteNotSent()`) has an unresolved
 * `PENDING` `QuotePriceProposal` open against it (GOS-53 Quote Negotiation).
 *
 * Without this check, a Customer could call `acceptQuote` while a
 * negotiated price proposal is still awaiting a decision, locking in
 * `Quote.price` (the ORIGINAL quoted price) into the `Engagement` even
 * though a not-yet-resolved negotiated price exists — `Engagement` itself
 * stores no price of its own; the "real" price is always derived as
 * `Quote.negotiatedPrice ?? Quote.price` (see `QuoteModel.finalPrice`). A
 * pending proposal must first be resolved (accepted/rejected) via
 * `acceptQuotePriceProposal`/`rejectQuotePriceProposal`
 * (`src/quote-negotiation/`) before this Quote can be accepted.
 *
 * NOT anti-enumeration — same reasoning as `quoteNotSent()`: the caller
 * already knows this is their own resource, so its current negotiation
 * state is safe to disclose. Deliberately does NOT block acceptance when
 * there is no proposal at all, or when the most recent proposal is already
 * `ACCEPTED`/`REJECTED`/`SUPERSEDED` — only an unresolved `PENDING` one
 * blocks.
 */
export function quoteHasPendingPriceProposal(): DomainException {
  return new DomainException(
    QUOTE_HAS_PENDING_PRICE_PROPOSAL_CODE,
    'This Quote has a pending price proposal that must be accepted or rejected before the Quote can be accepted.',
  );
}
