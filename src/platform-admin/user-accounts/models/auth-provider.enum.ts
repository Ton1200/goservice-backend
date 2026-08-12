import { registerEnumType } from '@nestjs/graphql';
import { AuthProvider } from '@prisma/client';

/**
 * Registers the Prisma-generated `AuthProvider` enum (`prisma/schema.prisma`)
 * directly as this endpoint's (`/admin/graphql`) GraphQL enum type — same
 * reasoning as `user-account-status.enum.ts`. Read-only here: `authProvider`
 * is never a field of `UpdateUserAccountInput` — it is set once at account
 * creation (password vs. social) and never changed by this admin capability.
 */
registerEnumType(AuthProvider, {
  name: 'AuthProvider',
  description: 'How a consumer User authenticates (password vs. social).',
});

export { AuthProvider };
