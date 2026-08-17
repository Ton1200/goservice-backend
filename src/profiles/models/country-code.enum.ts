import { registerEnumType } from '@nestjs/graphql';
import { CountryCode } from '@prisma/client';

/**
 * Registers the Prisma-generated `CountryCode` enum (`prisma/schema.prisma`)
 * directly as a GraphQL enum type — same reasoning as
 * `professional-verification-status.enum.ts`/`specialization-role.enum.ts`:
 * the GraphQL and persistence shapes are meant to be identical, so reusing
 * the single Prisma enum avoids two enums drifting out of sync.
 *
 * Lives here (not under `src/identity-verification/`) because
 * `CustomerProfile.country`/`ProfessionalProfile.country` are the columns
 * that actually OWN this value — `src/identity-verification/` only READS it
 * (server-side, never from a client input) to resolve which country to
 * route a verification session to. See
 * `IdentityVerificationProviderRegistry.resolve` for that read.
 *
 * Retroactively promoted (Identity Verification implementation) from a bare
 * `String @default("AR")` on both profile models — see each model's own
 * comment in `prisma/schema.prisma` for the migration this required.
 */
registerEnumType(CountryCode, {
  name: 'CountryCode',
  description:
    'An ISO 3166-1 alpha-2 country code GoService actively supports. Starts with AR (Argentina, initial market) and CO (Colombia, first confirmed expansion target).',
});

export { CountryCode };
