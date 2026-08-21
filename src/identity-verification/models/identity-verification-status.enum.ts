import { registerEnumType } from '@nestjs/graphql';
import { IdentityVerificationStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `IdentityVerificationStatus` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type — same
 * reasoning as `ProfessionalVerificationStatus`/`SpecializationRole`: the
 * GraphQL and persistence shapes are meant to be identical.
 *
 * `IdentityDocumentType` (also defined in `prisma/schema.prisma`) is
 * deliberately NOT registered as a GraphQL type here or anywhere else in
 * this module — no field on `IdentityVerificationModel` exposes it (see
 * that model's own comment). Registering an enum that no field ever
 * references would make it an ORPHANED type, the exact class of
 * schema-leak risk this codebase's own `PlatformConfigGroup`/`JsonScalar`
 * history already flagged (see `PlatformPublicSettingsModule`'s header
 * comment) — so it stays a Prisma/adapter-internal concept only.
 */
registerEnumType(IdentityVerificationStatus, {
  name: 'IdentityVerificationStatus',
  description:
    "One identity-verification attempt's own status — PENDING until both the document and biometric checks have reported a result; APPROVED only when BOTH passed; REJECTED otherwise. Distinct from, but drives, User.accountStatus.",
});

export { IdentityVerificationStatus };
