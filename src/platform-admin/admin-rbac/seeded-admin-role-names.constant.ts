/**
 * The 3 `AdminRole` names `scripts/bootstrap-super-admin.ts` seeds on a
 * fresh environment's first run — `SUPER_ADMIN`/`CONFIG_MANAGER`/
 * `SUPPORT_VIEWER`. Shared, single source of truth for "is this name one of
 * the 3 fixed, non-renamable/non-deletable seeded roles" — consumed by:
 *
 *   - `scripts/bootstrap-super-admin.ts` — validates its own `ROLE_SEEDS`
 *     names match this list (a cheap drift safety net; the actual
 *     PERMISSION defaults for each role still live in `ROLE_SEEDS` itself,
 *     never here).
 *   - `scripts/create-admin-user.ts` — re-exports this instead of keeping
 *     its own separate, duplicate array (it used to; see that script's own
 *     git history for the former `VALID_ADMIN_ROLE_NAMES` comment, which
 *     explicitly admitted the duplication and why it existed before this
 *     constant did).
 *   - `DeleteAdminRoleService` (`../admin-roles/services/delete-admin-role.service.ts`)
 *     — rejects deleting a role whose `name` is in this list
 *     (`ADMIN_ROLE_IS_SYSTEM_ROLE`). Note this is a NAME restriction only —
 *     these 3 roles' PERMISSION SETS remain fully editable via
 *     `updateAdminRolePermissions` (including `SUPER_ADMIN`'s own, by
 *     explicit human decision) — see that service's own header comment.
 *
 * Deliberately a plain module — zero Nest/Prisma imports — so both the
 * `ts-node` scripts above (which run outside Nest's DI container entirely)
 * and the backend's own DI graph can import this file identically, the same
 * relative-import mechanism `bootstrap-super-admin.ts` already uses to reuse
 * `Argon2PasswordHasherAdapter` from `src/`.
 */
export const SEEDED_ADMIN_ROLE_NAMES = [
  'SUPER_ADMIN',
  'CONFIG_MANAGER',
  'SUPPORT_VIEWER',
] as const;

export type SeededAdminRoleName = (typeof SEEDED_ADMIN_ROLE_NAMES)[number];

/** Whether `name` is one of the 3 fixed, seeded `AdminRole` names above. */
export function isSeededAdminRoleName(name: string): boolean {
  return (SEEDED_ADMIN_ROLE_NAMES as readonly string[]).includes(name);
}
