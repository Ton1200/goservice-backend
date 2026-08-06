import { registerEnumType } from '@nestjs/graphql';
import { SpecializationRole } from '@prisma/client';

/**
 * Registers the Prisma-generated `SpecializationRole` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type — same
 * rationale as `professional-verification-status.enum.ts`: the GraphQL
 * and persistence shapes are meant to be identical, so reusing the single
 * Prisma enum avoids two enums drifting out of sync and the nominal-type
 * mismatch two separately-declared TS enums would otherwise have.
 *
 * `PRIMARY` — a professional's main trade; exactly one specialization must
 * carry this role (enforced in `UpsertProfessionalProfileService`, not by
 * the database). `SECONDARY` — any additional trade they also do; zero or
 * more are allowed.
 */
registerEnumType(SpecializationRole, {
  name: 'SpecializationRole',
  description:
    "A professional specialization's role: PRIMARY (main trade, exactly one required) or SECONDARY (any additional trade, zero or more allowed).",
});

export { SpecializationRole };
