// GOS-30/31/32 (platform-admin) — standalone, ongoing-use admin-creation
// script. NOT a resolver, NOT reachable via any GraphQL endpoint, NOT wired
// into NestJS's DI container (mirrors `bootstrap-super-admin.ts`'s own
// pattern: a plain `PrismaClient`, run via `ts-node`, never `NestFactory`).
//
// This is a separate, complementary script to `bootstrap-super-admin.ts`
// (which remains untouched and is the one-time, env-var-based path to the
// very first SUPER_ADMIN). This script is for ongoing, on-demand admin-user
// creation/update after that first bootstrap has already run — e.g. an
// operator creating a CONFIG_MANAGER or SUPPORT_VIEWER whenever needed.
//
// DELIBERATE DESIGN CHOICE — CLI ARGUMENTS, NOT ENVIRONMENT VARIABLES:
// Unlike `bootstrap-super-admin.ts`, this script takes its email/password/
// name/role as CLI flags (--email, --password, --name, --role, --force)
// rather than environment variables. This was discussed explicitly with
// the human operator: CLI arguments are visible to any other local user on
// the same machine for the lifetime of the process (via `ps`/Task Manager/
// `/proc/<pid>/cmdline`), which env vars passed through a shell are not
// (env vars are visible via `/proc/<pid>/environ` on some platforms too,
// but generally considered slightly less exposed than argv). The operator
// was told this trade-off and explicitly chose CLI-argument flexibility
// anyway, because this is a tool they run themselves, locally, on-demand,
// not a shared/automated credential path. This is an ACCEPTED, DELIBERATE
// trade-off for this script — do not "fix" it back to environment
// variables without the human asking for that again.
//
// Run via `npm run admin:create-user -- --email ... --password ... --name
// ... --role ... [--force]` (see package.json). Reads DATABASE_URL from
// `.env` via `process.loadEnvFile` (same as `bootstrap-super-admin.ts`) —
// this script never reads or prints DATABASE_URL's value itself, only lets
// Prisma resolve it internally.
//
// Safety:
//   - Refuses to overwrite an existing AdminUser (matched by --email)
//     unless --force is explicitly passed.
//   - Refuses to create an AdminUser against a --role that hasn't been
//     seeded yet (i.e. `npm run admin:bootstrap` was never run) rather
//     than silently creating the AdminRole row itself — role seeding is
//     `bootstrap-super-admin.ts`'s job, not this script's.
//   - Applies the same password-strength policy already enforced for
//     consumer registration/reset (`RegisterInput.password` /
//     `ResetPasswordInput.newPassword` — minimum length 8, nothing
//     stricter has been specified anywhere in this codebase), checked
//     BEFORE the password hasher is ever invoked.
//   - Never prints the password (neither the newly-hashed one nor the
//     plaintext CLI argument) back to stdout/stderr.
import path from 'node:path';
import { PrismaClient, AdminUserStatus } from '@prisma/client';
import { Argon2PasswordHasherAdapter } from '../src/users/adapters/argon2-password-hasher.adapter';
import {
  SEEDED_ADMIN_ROLE_NAMES,
  type SeededAdminRoleName,
} from '../src/platform-admin/admin-rbac/seeded-admin-role-names.constant';

// Administrators-tab follow-up (2026-08-20): this used to keep its OWN,
// separate, manually-synced copy of the 3 seeded role names (with a comment
// explicitly admitting the duplication, since `bootstrap-super-admin.ts`
// itself was off-limits to import from — it runs `main()` unconditionally
// at module load, so importing it would trigger a live bootstrap run as a
// side effect). Now re-exported from the new shared, Nest/Prisma-import-free
// `seeded-admin-role-names.constant.ts`, which both this script and
// `bootstrap-super-admin.ts` import identically without that side-effect
// risk — see that constant's own header comment.
export const VALID_ADMIN_ROLE_NAMES = SEEDED_ADMIN_ROLE_NAMES;
export type AdminRoleName = SeededAdminRoleName;

export class CliArgumentError extends Error {}

export interface ParsedCreateAdminUserArgs {
  email: string;
  password: string;
  name: string;
  role: AdminRoleName;
  force: boolean;
}

/**
 * Normalizes a raw `--role` value against the 3 seeded role names
 * (case-insensitive input, canonical UPPER_SNAKE_CASE output). Returns
 * `null` when the value doesn't match any seeded role name.
 */
export function normalizeRoleName(raw: string): AdminRoleName | null {
  const upper = raw.trim().toUpperCase();
  const match = (VALID_ADMIN_ROLE_NAMES as readonly string[]).find(
    (name) => name === upper,
  );
  return (match as AdminRoleName | undefined) ?? null;
}

// Same policy already enforced for consumer registration/reset — see
// `src/users/models/register-input.model.ts` and
// `src/password-reset/models/reset-password-input.model.ts`: minimum
// length 8, nothing stricter is invented here for admin accounts either.
const MIN_PASSWORD_LENGTH = 8;

/**
 * Returns an error message string when `password` violates the shared
 * password policy, or `null` when it passes. Deliberately returns rather
 * than throws so callers can decide how to report it (CLI argument
 * validation vs. something else) without a try/catch for control flow.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `create-admin-user: --password must be at least ${MIN_PASSWORD_LENGTH} characters (same policy as consumer registration/reset).`;
  }
  return null;
}

/**
 * Parses `process.argv.slice(2)`-shaped CLI arguments into a validated
 * `ParsedCreateAdminUserArgs`. Pure function — no I/O, no process access
 * beyond what's passed in — so it's unit-testable without a live DB.
 *
 * Throws `CliArgumentError` (never a partial/side-effecting result) when:
 *   - any of --email/--password/--name/--role is missing or blank, or
 *   - --role doesn't match one of the 3 seeded role names.
 *
 * Does NOT check the password-strength policy — call
 * `validatePasswordPolicy` separately once parsing succeeds, so the
 * "which flag is missing" error always takes precedence over policy
 * errors for a doubly-invalid invocation.
 */
export function parseArgs(argv: string[]): ParsedCreateAdminUserArgs {
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const flagName = token.slice(2);
    if (flagName === 'force') {
      flags.set('force', true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliArgumentError(
        `create-admin-user: flag --${flagName} requires a value.`,
      );
    }
    flags.set(flagName, value);
    i++;
  }

  const rawEmail = flags.get('email');
  const rawPassword = flags.get('password');
  const rawName = flags.get('name');
  const rawRole = flags.get('role');

  const missing: string[] = [];
  if (typeof rawEmail !== 'string' || rawEmail.trim() === '') {
    missing.push('--email');
  }
  if (typeof rawPassword !== 'string' || rawPassword === '') {
    missing.push('--password');
  }
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    missing.push('--name');
  }
  if (typeof rawRole !== 'string' || rawRole.trim() === '') {
    missing.push('--role');
  }
  if (missing.length > 0) {
    throw new CliArgumentError(
      `create-admin-user: missing required argument(s): ${missing.join(', ')}.`,
    );
  }

  const role = normalizeRoleName(rawRole as string);
  if (!role) {
    throw new CliArgumentError(
      `create-admin-user: --role must be one of ${VALID_ADMIN_ROLE_NAMES.join(', ')} (case-insensitive); got "${rawRole}".`,
    );
  }

  return {
    email: (rawEmail as string).trim(),
    password: rawPassword as string,
    name: (rawName as string).trim(),
    role,
    force: flags.get('force') === true,
  };
}

/** Message used when an existing AdminUser is found and `--force` was not passed. */
export function describeExistingWithoutForce(email: string): string {
  return `create-admin-user: an AdminUser with email "${email}" already exists — refusing to overwrite. Re-run with --force to update its role/password/display name.`;
}

/** Message used when --role doesn't have a matching seeded AdminRole row yet. */
export function describeRoleNotSeeded(role: AdminRoleName): string {
  return `create-admin-user: AdminRole "${role}" does not exist yet — run "npm run admin:bootstrap" first to seed the 3 admin roles, then re-run this script.`;
}

async function ensureRoleId(
  prisma: PrismaClient,
  role: AdminRoleName,
): Promise<string> {
  const roleRow = await prisma.adminRole.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(describeRoleNotSeeded(role));
  }
  return roleRow.id;
}

async function run(args: ParsedCreateAdminUserArgs): Promise<void> {
  const prisma = new PrismaClient();
  const passwordHasher = new Argon2PasswordHasherAdapter();

  try {
    const roleId = await ensureRoleId(prisma, args.role);

    const existing = await prisma.adminUser.findUnique({
      where: { email: args.email },
    });

    if (existing && !args.force) {
      throw new Error(describeExistingWithoutForce(args.email));
    }

    const passwordHash = await passwordHasher.hash(args.password);

    if (existing) {
      // Status is intentionally left untouched here: --force lets an
      // operator rotate role/password/display name, but does not
      // implicitly reactivate a REVOKED admin — that would be a separate,
      // more sensitive decision this script doesn't make silently.
      const updated = await prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          displayName: args.name,
          passwordHash,
          roleId,
        },
      });
      console.log(
        `create-admin-user: updated existing AdminUser (role, password, and display name overwritten; status left unchanged).`,
      );
      console.log(`  email:  ${updated.email}`);
      console.log(`  role:   ${args.role}`);
      console.log(`  status: ${updated.status}`);
      return;
    }

    const created = await prisma.adminUser.create({
      data: {
        email: args.email,
        displayName: args.name,
        passwordHash,
        roleId,
        status: AdminUserStatus.ACTIVE,
      },
    });
    console.log(`create-admin-user: created new AdminUser.`);
    console.log(`  email:  ${created.email}`);
    console.log(`  role:   ${args.role}`);
    console.log(`  status: ${created.status}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so this module can be `import`ed by unit tests (for `parseArgs`,
// `normalizeRoleName`, `validatePasswordPolicy`, etc.) without triggering a
// live run against `process.argv`/the database as a side effect — unlike
// `bootstrap-super-admin.ts`, which is never imported anywhere and so
// doesn't need this guard.
if (require.main === module) {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));

  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const passwordPolicyError = validatePasswordPolicy(args.password);
    if (passwordPolicyError) {
      throw new CliArgumentError(passwordPolicyError);
    }
    await run(args);
  })().catch((error: unknown) => {
    if (error instanceof CliArgumentError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
