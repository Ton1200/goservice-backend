import { registerEnumType } from '@nestjs/graphql';
import { EngagementChatParty } from '@prisma/client';

/**
 * Registers the Prisma-generated `EngagementChatParty` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `QuoteNegotiationParty`/`QuoteStatus`/
 * `ServiceRequestStatus`. Represents which role the caller is acting in ON
 * A SPECIFIC ENGAGEMENT (a User could theoretically hold both a
 * `CustomerProfile` and a `ProfessionalProfile` — see
 * `EngagementChatAccessService.resolveParty`), not the caller's identity in
 * general. Deliberately a SEPARATE enum from `QuoteNegotiationParty`, even
 * though both currently only have `CUSTOMER`/`PROFESSIONAL` values — each is
 * tied to its own capability's specific parent entity (a Quote vs. an
 * Engagement), same "one enum per capability-context" precedent
 * `QuoteNegotiationParty`'s own comment already establishes.
 */
registerEnumType(EngagementChatParty, {
  name: 'EngagementChatParty',
  description:
    'Which role a caller acted in on a specific Engagement Chat message — CUSTOMER or PROFESSIONAL, the two parties on the Engagement.',
});

export { EngagementChatParty };
