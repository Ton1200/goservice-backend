import { registerEnumType } from '@nestjs/graphql';
import { AppointmentStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `AppointmentStatus` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `QuoteStatus`/`QuotePriceProposalStatus`. PENDING
 * (proposed, awaiting the other party) -> CONFIRMED (accepted by the
 * non-proposing party) or CANCELLED (either party, from PENDING or
 * CONFIRMED) — CANCELLED is terminal, never reverts.
 */
registerEnumType(AppointmentStatus, {
  name: 'AppointmentStatus',
  description:
    'PENDING (proposed, awaiting the other party) -> CONFIRMED (accepted) or CANCELLED (terminal, either party, from PENDING or CONFIRMED).',
});

export { AppointmentStatus };
