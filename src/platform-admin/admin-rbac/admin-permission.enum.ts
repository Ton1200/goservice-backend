import { registerEnumType } from '@nestjs/graphql';
import { Permission } from '@prisma/client';

/**
 * Registers the Prisma-generated `Permission` enum (`prisma/schema.prisma`)
 * directly as this endpoint's GraphQL enum type — same reasoning as
 * `src/profiles/models/professional-verification-status.enum.ts`: the
 * GraphQL and persistence shapes are meant to be identical here, so reusing
 * the single Prisma enum avoids two enums drifting out of sync.
 *
 * The full 7-permission catalog across all 4 planned platform-admin slices
 * — Slice 1 only ever grants/checks `FEATURE_FLAGS_READ`/`FEATURE_FLAGS_WRITE`
 * in live code paths, but the enum (and `AdminRole.permissions`) must carry
 * the full set now so Slices 2-4 need no future migration.
 */
registerEnumType(Permission, {
  name: 'Permission',
  description:
    'A single admin capability grant. An AdminRole holds a set of these; AdminPermissionsGuard re-queries them from the database on every request.',
});

export { Permission };
