import { registerEnumType } from '@nestjs/graphql';
import { AddressOwnerRole } from '@prisma/client';

/**
 * Registers the Prisma-generated `AddressOwnerRole` enum directly as a
 * GraphQL enum type — same "GraphQL and persistence shapes are meant to be
 * identical" reasoning as `QuoteNegotiationParty`
 * (`src/quote-negotiation/models/quote-negotiation-party.enum.ts`).
 * Represents which kind of profile owns a given `Address` — a User could
 * hold both a `CustomerProfile` and a `ProfessionalProfile` and save
 * addresses under each independently.
 */
registerEnumType(AddressOwnerRole, {
  name: 'AddressOwnerRole',
  description:
    'Which kind of profile owns a saved Address — CUSTOMER or PROFESSIONAL. A User holding both profile types may save independent Address lists under each.',
});

export { AddressOwnerRole };
