import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN_CODE =
  'QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN';

/**
 * Thrown by `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService`
 * when the caller's resolved party role matches the proposal's own
 * `proposedByRole` — the author of a price proposal can never accept or
 * reject their own proposal. Checked BEFORE the `PENDING` status check, so
 * a self-attempt gets this specific error regardless of the proposal's
 * current state.
 */
export function quotePriceProposalSelfResolveForbidden(): DomainException {
  return new DomainException(
    QUOTE_PRICE_PROPOSAL_SELF_RESOLVE_FORBIDDEN_CODE,
    'You cannot accept or reject your own price proposal.',
  );
}
