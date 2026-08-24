import { registerEnumType } from '@nestjs/graphql';
import { AppointmentParty } from '@prisma/client';

/**
 * Registers the Prisma-generated `AppointmentParty` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `QuoteNegotiationParty`/`EngagementChatParty`.
 * Represents which role the caller acted in ON A SPECIFIC Appointment (who
 * PROPOSED it — see `AppointmentModel.proposedByRole`), not the caller's
 * identity in general (a User could theoretically hold both a
 * `CustomerProfile` and a `ProfessionalProfile` — see
 * `AppointmentAccessService.resolveParty`).
 */
registerEnumType(AppointmentParty, {
  name: 'AppointmentParty',
  description:
    'Which role proposed a specific Appointment — CUSTOMER or PROFESSIONAL (see Appointment.proposedByRole).',
});

export { AppointmentParty };
