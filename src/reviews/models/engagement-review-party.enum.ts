import { registerEnumType } from '@nestjs/graphql';
import { EngagementReviewParty } from '@prisma/client';

/**
 * Registers the Prisma-generated `EngagementReviewParty` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `EngagementChatParty`/`QuoteNegotiationParty`.
 * Deliberately its OWN enum, tied to `Review`/`Engagement`, even though it
 * currently only has the same two values as those siblings — same
 * "one enum per capability-context" precedent `EngagementChatParty`'s own
 * comment already establishes.
 */
registerEnumType(EngagementReviewParty, {
  name: 'EngagementReviewParty',
  description:
    'Which role a Review author acted in on a specific Engagement — CUSTOMER or PROFESSIONAL, the two parties on the Engagement.',
});

export { EngagementReviewParty };
