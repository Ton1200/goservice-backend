import { registerEnumType } from '@nestjs/graphql';
import { AdminUserStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `AdminUserStatus` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type — same reasoning
 * as `src/users/models/user-account-status.enum.ts`: the GraphQL and
 * persistence shapes are meant to be identical here, so reusing the single
 * Prisma enum avoids two enums drifting out of sync. Reused for BOTH output
 * (`AdminUserModel.status`) and input (`UpdateAdminUserInput.status`) — same
 * convention `UserAccountStatus` already establishes for
 * `UserAccountModel`/`UpdateUserAccountInput`.
 */
registerEnumType(AdminUserStatus, {
  name: 'AdminUserStatus',
  description:
    "An AdminUser's lifecycle status: INVITED (no password set yet, only reachable via the invite flow), ACTIVE (can log in and exercise whatever Permissions their role grants), REVOKED (adminLogin rejects; AdminPermissionsGuard treats a non-ACTIVE admin as holding zero Permissions, even with an existing session token).",
});

export { AdminUserStatus };
