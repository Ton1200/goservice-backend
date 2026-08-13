import { registerEnumType } from '@nestjs/graphql';
import { UserAccountStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `UserAccountStatus` enum
 * (`prisma/schema.prisma`) directly as a GraphQL enum type — same reasoning
 * as `src/profiles/models/professional-verification-status.enum.ts`: the
 * GraphQL and persistence shapes are meant to be identical here, so reusing
 * the single Prisma enum avoids two enums drifting out of sync.
 *
 * Lives here, in `src/users/models/`, rather than with the first feature
 * that happened to expose it over GraphQL (originally
 * `src/platform-admin/user-accounts/models/`, admin-only) — the enum
 * belongs with the domain module that owns the underlying `User.accountStatus`
 * column, same convention `ProfessionalVerificationStatus` already
 * establishes for `src/profiles/models/`. Reachable from BOTH the admin
 * schema (`UserAccountModel`/`UserAccountDetailModel`/
 * `UpdateUserAccountInput` in `src/platform-admin/user-accounts/models/`)
 * and the public consumer schema (`MyAccount` in
 * `src/profiles/models/my-account.model.ts`) — this relocation is a pure
 * file-organization move, the registered GraphQL type name/description are
 * unchanged.
 */
registerEnumType(UserAccountStatus, {
  name: 'UserAccountStatus',
  description:
    "A consumer User's account approval/verification status. See prisma/schema.prisma's own header comment on this enum for which values are actually assignable today.",
});

export { UserAccountStatus };
