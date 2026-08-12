import { registerEnumType } from '@nestjs/graphql';
import { UserAccountStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `UserAccountStatus` enum
 * (`prisma/schema.prisma`) directly as this endpoint's (`/admin/graphql`)
 * GraphQL enum type — same reasoning as `admin-permission.enum.ts`/
 * `platform-setting-value-type.enum.ts`: the GraphQL and persistence shapes
 * are meant to be identical here, so reusing the single Prisma enum avoids
 * two enums drifting out of sync. Not previously exposed via GraphQL
 * anywhere — this is the first time `UserAccountStatus` is reachable over
 * the wire, admin-only.
 */
registerEnumType(UserAccountStatus, {
  name: 'UserAccountStatus',
  description:
    "A consumer User's account approval/verification status. See prisma/schema.prisma's own header comment on this enum for which values are actually assignable today.",
});

export { UserAccountStatus };
