import { registerEnumType } from '@nestjs/graphql';
import { ProfessionalVerificationStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `ProfessionalVerificationStatus` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type, rather than
 * hand-rolling a second, structurally-identical TS enum (as
 * `src/auth/enums/social-provider.enum.ts` does for `SocialProvider` —
 * that one is deliberately distinct from Prisma's `AuthProvider` because
 * their value sets differ). Here the GraphQL and persistence shapes are
 * meant to be identical, so reusing the single Prisma enum avoids two
 * enums silently drifting out of sync, and avoids a nominal-type mismatch
 * between them (TS enums with identical string values are still NOT
 * mutually assignable unless they're the same declaration).
 *
 * Always `UNVERIFIED` on profile creation in this story;
 * `PENDING_REVIEW`/`VERIFIED`/`REJECTED` are reserved for a future
 * Identity Verification story and are never assigned by any code path
 * here. `UpsertProfessionalProfileInput` has no field of this type at all
 * — it cannot be set from GraphQL.
 */
registerEnumType(ProfessionalVerificationStatus, {
  name: 'ProfessionalVerificationStatus',
  description:
    "A professional's identity-document verification status. Always UNVERIFIED on profile creation; only a future Identity Verification story can change it.",
});

export { ProfessionalVerificationStatus };
