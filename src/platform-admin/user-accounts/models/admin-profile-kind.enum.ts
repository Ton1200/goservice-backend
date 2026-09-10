import { registerEnumType } from '@nestjs/graphql';

/**
 * GOS-70 — which of a consumer `User`'s two profiles an admin profile-photo
 * mutation targets. A GraphQL-only enum (there is no matching Prisma enum —
 * the two profiles are separate tables, not a discriminated column).
 */
export enum AdminProfileKind {
  CUSTOMER = 'CUSTOMER',
  PROFESSIONAL = 'PROFESSIONAL',
}

registerEnumType(AdminProfileKind, {
  name: 'AdminProfileKind',
  description:
    "Which of a consumer User's profiles to act on: their CustomerProfile or their ProfessionalProfile.",
});
