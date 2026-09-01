import { registerEnumType } from '@nestjs/graphql';
import { QuotePriceProposalStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `QuotePriceProposalStatus` enum directly
 * as a GraphQL enum type. `PENDING` is the only non-terminal state;
 * `ACCEPTED`/`REJECTED`/`SUPERSEDED` are all terminal — `SUPERSEDED` is set
 * automatically the instant a NEW price proposal is posted on the same
 * Quote (see `PostQuoteNegotiationMessageService`'s CAS-supersede write),
 * never by an explicit accept/reject call.
 */
registerEnumType(QuotePriceProposalStatus, {
  name: 'QuotePriceProposalStatus',
  description:
    'PENDING while awaiting a decision; ACCEPTED/REJECTED once the counterparty resolves it; SUPERSEDED automatically once a newer price proposal is posted on the same Quote. ACCEPTED/REJECTED/SUPERSEDED are all terminal.',
});

export { QuotePriceProposalStatus };
