import { registerEnumType } from '@nestjs/graphql';
import { QuoteStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `QuoteStatus` enum directly as a GraphQL
 * enum type — same reasoning as `ServiceRequestStatus`/
 * `ProfessionalVerificationStatus`: the GraphQL and persistence shapes are
 * meant to be identical. See `prisma/schema.prisma`'s own comment on this
 * enum for the full transition rules (SENT is the only non-terminal state;
 * REJECTED covers both an explicit Customer rejection and the automatic
 * rejection of sibling Quotes once one is accepted).
 */
registerEnumType(QuoteStatus, {
  name: 'QuoteStatus',
  description:
    'SENT while awaiting a decision; WITHDRAWN if the Professional retracts it; REJECTED if the Customer explicitly rejects it OR another sibling Quote on the same ServiceRequest was accepted; ACCEPTED if the Customer accepted it. WITHDRAWN/REJECTED/ACCEPTED are all terminal.',
});

export { QuoteStatus };
