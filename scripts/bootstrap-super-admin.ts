// GOS-30/31/32 (platform-admin, Slice 1) — standalone bootstrap script. NOT
// a resolver, NOT reachable via any GraphQL endpoint, NOT wired into
// NestJS's DI container (mirrors `prisma/seed.ts`'s own pattern: a plain
// `PrismaClient`, run via `ts-node`, never `NestFactory`). The only way to
// create the very first `AdminUser` — nothing in the `/admin/graphql`
// schema itself can (Slice 1 has no `inviteAdminUser` mutation yet; that's
// Slice 3), by design: an internal tool's first admin should never be
// self-service-creatable over the network.
//
// Run via `npm run admin:bootstrap` (see package.json). Reads
// ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD /
// ADMIN_BOOTSTRAP_DISPLAY_NAME from the environment — these are optional in
// `env-validation.schema.ts` (the running app never requires them) but
// required here, validated explicitly below.
//
// Idempotent in two independent ways:
//   1. The 3 AdminRole rows are upserted by `name` — safe to re-run.
//   2. Exactly one SUPER_ADMIN AdminUser is ever created: if ANY AdminUser
//      already holds the SUPER_ADMIN role, this script is a no-op for that
//      part, regardless of the email/password currently in the
//      environment — re-running never creates a second super-admin.
//
// PERMISSIONS GUARANTEE — NARROWED (Administrators-tab follow-up,
// 2026-08-20): `seedRoles()`'s `upsert` used to reset `permissions` on
// EVERY run (`update: { permissions: seed.permissions }`) — safe only
// because no other mechanism could ever change a role's permissions after
// seeding. That stopped being true the moment `updateAdminRolePermissions`
// (a real, live-editable Roles UI) shipped: re-running this script would
// have silently clobbered any customization made through that UI, including
// on `SUPER_ADMIN` itself. `update: {}` below means this script now only
// ever CREATES a role's permissions the first time that role is seeded —
// it never again resets them once the row exists. Explicit consequence: a
// brand-new `Permission` enum value added in a future code change is still
// correctly granted on a FRESH environment's first bootstrap run (via
// `create`), but on an ALREADY-BOOTSTRAPPED environment (like a running
// deployment, or this developer machine) it must now be granted by hand
// through the Roles UI (`updateAdminRolePermissions`) — `npm run
// admin:bootstrap` is NO LONGER the recovery mechanism for that gap. This is
// exactly the class of real incident that motivated this change: this
// script was re-run minutes before this comment was written to work around
// that very gap for `QUOTES_READ` — that workaround is no longer available
// (nor necessary) once the Roles UI exists.
import path from 'node:path';
import { PrismaClient, Permission } from '@prisma/client';
import { Argon2PasswordHasherAdapter } from '../src/users/adapters/argon2-password-hasher.adapter';
import { SEEDED_ADMIN_ROLE_NAMES } from '../src/platform-admin/admin-rbac/seeded-admin-role-names.constant';

process.loadEnvFile(path.join(__dirname, '..', '.env'));

const prisma = new PrismaClient();
// Plain class, no constructor dependencies — reused directly rather than
// duplicating argon2id wiring, without needing to bootstrap a NestJS DI
// container just for this standalone script.
const passwordHasher = new Argon2PasswordHasherAdapter();

const ROLE_SEEDS: { name: string; permissions: Permission[] }[] = [
  {
    name: 'SUPER_ADMIN',
    permissions: [
      Permission.FEATURE_FLAGS_READ,
      Permission.FEATURE_FLAGS_WRITE,
      Permission.CREDENTIALS_READ,
      Permission.CREDENTIALS_WRITE,
      Permission.ADMIN_USERS_MANAGE,
      Permission.SESSIONS_READ,
      Permission.AUDIT_LOG_READ,
      // GOS-3x follow-up (2026-08-10) — userAccounts/updateUserAccount/
      // forceUserAccountPasswordReset. SUPER_ADMIN gets every permission.
      Permission.USER_ACCOUNTS_READ,
      Permission.USER_ACCOUNTS_WRITE,
      // GOS-3x follow-up (hard-delete, 2026-08-11) — explicit human
      // decision: deleteUserAccount/bulkDeleteUserAccounts (PERMANENT,
      // irreversible deletion — REPLACES an earlier round's reversible
      // deactivate/reactivate soft-delete) are SUPER_ADMIN ONLY.
      // Deliberately NOT added to CONFIG_MANAGER below, even though
      // CONFIG_MANAGER already holds USER_ACCOUNTS_WRITE — permanently
      // erasing a real consumer account is far more consequential than
      // editing a field and deserves a higher bar. See ADR 0005's Tenth
      // round for the full rationale, including the explicit human
      // authorization for this irreversible operation.
      Permission.USER_ACCOUNTS_DELETE,
      // GOS-38 follow-up (2026-08-18) — serviceRequests/serviceRequestDetail,
      // read-only admin grid. SUPER_ADMIN gets every permission.
      Permission.SERVICE_REQUESTS_READ,
      // GOS-38 follow-up (2026-08-18, same day) — "create ServiceRequest
      // for a customer". SUPER_ADMIN gets every permission.
      Permission.SERVICE_REQUESTS_WRITE,
      // Category-tree follow-up (2026-08-18) — full Category catalog CRUD
      // + hierarchy management. SUPER_ADMIN gets every permission.
      Permission.CATEGORIES_READ,
      Permission.CATEGORIES_WRITE,
      // Quotes admin grid follow-up (2026-08-19) — quotes/quoteDetail,
      // read-only admin grid. SUPER_ADMIN gets every permission.
      Permission.QUOTES_READ,
      // Quote Negotiation admin audit surface follow-up (GOS-53, 2026-08-21)
      // — adminQuoteNegotiationThread, its own dedicated permission (NOT
      // SERVICE_REQUESTS_READ/QUOTES_READ — see the Permission enum's own
      // comment in schema.prisma). SUPER_ADMIN gets every permission.
      Permission.QUOTE_NEGOTIATION_READ,
    ],
  },
  {
    name: 'CONFIG_MANAGER',
    permissions: [
      Permission.FEATURE_FLAGS_READ,
      Permission.FEATURE_FLAGS_WRITE,
      Permission.CREDENTIALS_READ,
      Permission.CREDENTIALS_WRITE,
      // GOS-3x follow-up (2026-08-10) — explicit human decision:
      // CONFIG_MANAGER-and-above can edit consumer user accounts from the
      // admin panel's new Users grid.
      Permission.USER_ACCOUNTS_READ,
      Permission.USER_ACCOUNTS_WRITE,
      // Deliberately NOT Permission.USER_ACCOUNTS_DELETE — see the
      // SUPER_ADMIN role seed's own comment above.
      // GOS-38 follow-up (2026-08-18) — read-only, mirrors
      // USER_ACCOUNTS_READ's own presence on this role.
      Permission.SERVICE_REQUESTS_READ,
      // GOS-38 follow-up (2026-08-18, same day) — explicit human decision:
      // CONFIG_MANAGER-and-above can create a ServiceRequest on behalf of
      // an approved customer, mirroring USER_ACCOUNTS_WRITE's own presence
      // on this role.
      Permission.SERVICE_REQUESTS_WRITE,
      // Category-tree follow-up (2026-08-18) — explicit human decision:
      // CONFIG_MANAGER-and-above can manage the Category catalog
      // (create/rename/reorder/re-parent/delete), mirroring
      // SERVICE_REQUESTS_READ/WRITE's own presence on this role.
      Permission.CATEGORIES_READ,
      Permission.CATEGORIES_WRITE,
      // Quotes admin grid follow-up (2026-08-19) — explicit human decision:
      // CONFIG_MANAGER-and-above can view Quotes, mirroring
      // SERVICE_REQUESTS_READ/CATEGORIES_READ's own presence on this role.
      Permission.QUOTES_READ,
      // Quote Negotiation admin audit surface follow-up (GOS-53, 2026-08-21)
      // — explicit human decision: CONFIG_MANAGER-and-above can audit a
      // Quote's negotiation thread, mirroring QUOTES_READ's own presence on
      // this role.
      Permission.QUOTE_NEGOTIATION_READ,
    ],
  },
  {
    name: 'SUPPORT_VIEWER',
    permissions: [
      Permission.FEATURE_FLAGS_READ,
      Permission.SESSIONS_READ,
      Permission.AUDIT_LOG_READ,
      // GOS-3x follow-up (2026-08-10) — read-only, matching this role's
      // existing *_READ-only semantics.
      Permission.USER_ACCOUNTS_READ,
      // GOS-38 follow-up (2026-08-18) — same read-only semantics.
      Permission.SERVICE_REQUESTS_READ,
      // Category-tree follow-up (2026-08-18) — same read-only semantics;
      // this role can view the catalog/tree but never create/rename/
      // reorder/re-parent/delete.
      Permission.CATEGORIES_READ,
      // Quotes admin grid follow-up (2026-08-19) — same read-only
      // semantics; this role can view Quotes but there is no write
      // capability to withhold anyway (no QUOTES_WRITE exists).
      Permission.QUOTES_READ,
      // Quote Negotiation admin audit surface follow-up (GOS-53, 2026-08-21)
      // — same read-only semantics; mirrors QUOTES_READ's own presence on
      // this role.
      Permission.QUOTE_NEGOTIATION_READ,
    ],
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `bootstrap-super-admin: missing required environment variable ${name}.`,
    );
  }
  return value;
}

/**
 * Cheap drift safety net: `ROLE_SEEDS` (above) and `SEEDED_ADMIN_ROLE_NAMES`
 * (the shared constant `DeleteAdminRoleService`/`create-admin-user.ts` also
 * depend on) must always name the exact same 3 roles. Throws loudly at
 * startup rather than silently seeding a role `SEEDED_ADMIN_ROLE_NAMES`
 * doesn't know about (which would make it renamable/deletable through the
 * Roles UI despite being meant as a fixed system role) or vice versa.
 */
function assertRoleSeedsMatchSharedConstant(): void {
  const seedNames = new Set(ROLE_SEEDS.map((seed) => seed.name));
  const constantNames = new Set<string>(SEEDED_ADMIN_ROLE_NAMES);
  const sameSize = seedNames.size === constantNames.size;
  const sameMembers = [...seedNames].every((name) => constantNames.has(name));
  if (!sameSize || !sameMembers) {
    throw new Error(
      `bootstrap-super-admin: ROLE_SEEDS (${[...seedNames].join(', ')}) has drifted from SEEDED_ADMIN_ROLE_NAMES (${[...constantNames].join(', ')}) — keep both in sync.`,
    );
  }
}

async function seedRoles(): Promise<Map<string, string>> {
  const roleIdByName = new Map<string, string>();
  for (const seed of ROLE_SEEDS) {
    const role = await prisma.adminRole.upsert({
      where: { name: seed.name },
      // create-only for permissions — never resets an already-seeded role's
      // permissions again. See this file's own header comment ("PERMISSIONS
      // GUARANTEE — NARROWED").
      update: {},
      create: { name: seed.name, permissions: seed.permissions },
    });
    roleIdByName.set(role.name, role.id);
    console.log(`bootstrap-super-admin: role "${role.name}" ready.`);
  }
  return roleIdByName;
}

async function ensureSuperAdmin(superAdminRoleId: string): Promise<void> {
  const existing = await prisma.adminUser.findFirst({
    where: { roleId: superAdminRoleId },
  });
  if (existing) {
    console.log(
      `bootstrap-super-admin: a SUPER_ADMIN AdminUser already exists (${existing.email}) — skipping creation.`,
    );
    return;
  }

  const email = requireEnv('ADMIN_BOOTSTRAP_EMAIL');
  const password = requireEnv('ADMIN_BOOTSTRAP_PASSWORD');
  const displayName = requireEnv('ADMIN_BOOTSTRAP_DISPLAY_NAME');

  const passwordHash = await passwordHasher.hash(password);
  const created = await prisma.adminUser.create({
    data: {
      email,
      displayName,
      passwordHash,
      roleId: superAdminRoleId,
      status: 'ACTIVE',
    },
  });
  console.log(
    `bootstrap-super-admin: created SUPER_ADMIN AdminUser ${created.email} (${created.id}).`,
  );
}

async function main(): Promise<void> {
  assertRoleSeedsMatchSharedConstant();
  const roleIdByName = await seedRoles();
  const superAdminRoleId = roleIdByName.get('SUPER_ADMIN');
  if (!superAdminRoleId) {
    throw new Error('bootstrap-super-admin: SUPER_ADMIN role seed failed.');
  }
  await ensureSuperAdmin(superAdminRoleId);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
