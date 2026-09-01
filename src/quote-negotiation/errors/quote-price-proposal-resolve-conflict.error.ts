import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT_CODE =
  'QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT';

/**
 * Thrown by `AcceptQuotePriceProposalService`/`RejectQuotePriceProposalService`
 * when the guarded `updateMany` CAS write (`WHERE id = X AND status =
 * 'PENDING'` -> `ACCEPTED`/`REJECTED`) reports `count !== 1` — i.e. this
 * call LOST a race against another concurrent resolution of the SAME
 * proposal (a double-accept, an accept-vs-reject, or a lost race against a
 * new message auto-superseding this proposal). Same "generic conflict
 * error, never a partial write" idiom as `quotes/errors/quote-accept-conflict.error.ts`'s
 * own `quoteAcceptConflict()`.
 */
export function quotePriceProposalResolveConflict(): DomainException {
  return new DomainException(
    QUOTE_PRICE_PROPOSAL_RESOLVE_CONFLICT_CODE,
    'This price proposal could not be resolved — its state changed concurrently.',
  );
}
