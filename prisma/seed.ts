// GOS-14/GOS-28 — minimal read-only Category catalog. No CRUD, no GraphQL
// mutation ever creates/updates/deletes a Category; this is the ONLY place
// Category rows are created. Run via `npm run prisma:seed`
// (`prisma db seed`, wired in package.json's `prisma.seed` config).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Matches the product vision's example service list (CLAUDE.md) — plumbing,
// electricity, carpentry, fencing, painting, gardening, cleaning, general
// maintenance, appliance repair.
const CATEGORIES = [
  'Plomería',
  'Electricidad',
  'Carpintería',
  'Cercado',
  'Pintura',
  'Jardinería',
  'Limpieza',
  'Mantenimiento general',
  'Reparación de electrodomésticos',
] as const;

// GOS-30/31/32 (platform-admin) — the two boolean `PlatformSetting` rows the
// reference case (gating `SocialLoginService`) depends on. Both default
// `value: 'true'` — the point of the setting is letting an admin turn an
// already-working provider OFF during an incident, not requiring an opt-in
// before it works at all. Upserted here (not by
// `scripts/bootstrap-super-admin.ts`) since this file is already the
// project's one seeding mechanism for reference/catalog data (`npm run
// prisma:seed`), same idempotent upsert-by-key pattern as `Category` above.
//
// `isEncrypted: false` (these are plain on/off switches, not secrets) AND
// `isPublic: true` (GOS-3x follow-up #2, 2026-08-10 — `isPublic` is back as
// its own independent, default-OFF gate; see `PlatformSetting`'s own header
// comment in `prisma/schema.prisma`) — BOTH are now required for a row to
// be automatically visible via `platformConfig`, which is exactly the kind
// of thing `goservice-mobile` needs to know about before showing a "Sign in
// with Google" button; see `src/platform-admin/platform-settings/public/`.
// The corresponding
// `customer.social-login.<provider>.client-id` credential (`isEncrypted:
// true`) is NOT seeded here — an admin must configure it via
// `setPlatformSetting` in the panel; see `SOCIAL_LOGIN_MISCONFIGURED` in
// `src/auth/errors/social-login-misconfigured.error.ts` for what happens
// until they do.
//
// `FeatureFlag`/`PlatformCredential` (the two-model design this superseded)
// were both dropped by the consolidation migration
// (`20260808210000_consolidate_platform_settings`) — there is no legacy
// table/data left to clean up here anymore; a fresh `PlatformSetting` table
// only ever has what this seed (and the admin panel) puts into it.
// GOS-3x follow-up (2026-08-10) — Resend transactional-email provider
// config, migrated from `.env`/`ConfigService` to admin-managed
// `PlatformSetting` rows, mirroring the social-login pattern above:
// `notifications.email.resend.<field>`. See
// `src/email/constants/resend-settings.constants.ts` for the key
// constants, and `src/email/services/ensure-email-delivery-available.service.ts`
// for the upfront gate `register`/`resendVerificationCode`/
// `requestPasswordReset` now all call first.
//
// `enabled` is DELIBERATELY seeded `'false'` (fail-closed), unlike the
// social-login flags above: no real Resend API key exists to seed
// alongside it, so `enabled: true` with no key would be a broken
// half-state. An admin must flip this on AND enter the real key together,
// in one deliberate activation step via the panel. `isPublic: false` (not
// `true`, unlike the social-login flags): this is backend-only
// configuration — the mobile app has no reason to know whether email
// delivery is enabled.
//
// `from-name` is seeded `'GoService'`, matching the pre-migration
// `EMAIL_FROM_NAME` env var's own default, so any environment that never
// customized it keeps the same behavior after this migration.
//
// `api-key` (a real secret, `isEncrypted: true`) and `from-address` are
// deliberately NOT seeded here — no safe/real default exists for either.
// They render in the admin panel via the generalized `KNOWN_SETTING_SLOTS`
// mechanism (`admin-panel/js/settings.js`) as "not configured yet"
// placeholders instead, exactly like Google/Apple's `client-id` do today.
const PLATFORM_SETTINGS: {
  key: string;
  description: string;
  value: string;
  isPublic?: boolean;
}[] = [
  {
    key: 'customer.social-login.google.enabled',
    description: 'Gates Google sign-in (socialLogin GOOGLE).',
    value: 'true',
    isPublic: true,
  },
  {
    key: 'customer.social-login.apple.enabled',
    description: 'Gates Apple sign-in (socialLogin APPLE).',
    value: 'true',
    isPublic: true,
  },
  {
    key: 'notifications.email.resend.enabled',
    description:
      'Gates the Resend transactional-email provider (register/resendVerificationCode/requestPasswordReset).',
    value: 'false',
    isPublic: false,
  },
  {
    key: 'notifications.email.resend.from-name',
    description: 'Display name used alongside the Resend from-address.',
    value: 'GoService',
    isPublic: false,
  },
];

async function main(): Promise<void> {
  for (const name of CATEGORIES) {
    // upsert-on-name makes the seed itself idempotent/re-runnable.
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const setting of PLATFORM_SETTINGS) {
    // update: {} — an already-toggled setting's real `value` is never
    // clobbered back to its seeded default by re-running the seed.
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: {
        key: setting.key,
        description: setting.description,
        // `from-name` is the one STRING row in this list — every other row
        // here is a BOOLEAN on/off switch. Keyed off the value shape rather
        // than adding a per-row `valueType` field, since a boolean's stored
        // value is always literally `'true'`/`'false'`.
        valueType: setting.value === 'true' || setting.value === 'false'
          ? 'BOOLEAN'
          : 'STRING',
        isEncrypted: false,
        isPublic: setting.isPublic ?? false,
        value: setting.value,
      },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
