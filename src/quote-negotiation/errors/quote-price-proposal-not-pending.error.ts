import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_PRICE_PROPOSAL_NOT_PENDING_CODE =
  'QUOTE_PRICE_PROPOSAL_NOT_PENDING';

/**
 * Thrown by `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService`'s
 * pre-read when the target `QuotePriceProposal` (already confirmed to
 * belong to a Quote the caller is a party to — see
 * `quotePriceProposalNotFound()`) is not `PENDING` (already
 * `ACCEPTED`/`REJECTED`/`SUPERSEDED`). NOT anti-enumeration — same
 * reasoning as `quoteNotSent()`: the caller already knows this is their own
 * resource, so its current state is safe to disclose.
 */
export function quotePriceProposalNotPending(): DomainException {
  return new DomainException(
    QUOTE_PRICE_PROPOSAL_NOT_PENDING_CODE,
    'This price proposal is no longer PENDING.',
  );
}
