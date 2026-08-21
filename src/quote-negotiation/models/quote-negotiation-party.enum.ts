import { registerEnumType } from '@nestjs/graphql';
import { QuoteNegotiationParty } from '@prisma/client';

/**
 * Registers the Prisma-generated `QuoteNegotiationParty` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `QuoteStatus`/`ServiceRequestStatus`. Represents
 * which role the caller is acting in ON A SPECIFIC QUOTE (a User could
 * theoretically hold both a `CustomerProfile` and a `ProfessionalProfile` —
 * see `QuoteNegotiationAccessService.resolveParty`), not the caller's
 * identity in general.
 */
registerEnumType(QuoteNegotiationParty, {
  name: 'QuoteNegotiationParty',
  description:
    'Which role a caller acted in on a specific Quote Negotiation message/proposal — CUSTOMER (the ServiceRequest owner) or PROFESSIONAL (the Quote submitter).',
});

export { QuoteNegotiationParty };
