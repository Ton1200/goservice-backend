import { randomBytes } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AbstractLoader, ExpressLoader } from '@nestjs/serve-static';
import { Test, TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SOCIAL_AUTH_PROVIDER_CONFIG } from '../../src/auth/config/social-auth-provider.config';
import type { SocialAuthProviderConfigMap } from '../../src/auth/config/social-auth-provider.config';
import { applySecurityMiddleware } from '../../src/bootstrap/apply-security-middleware';
import type { AppConfig } from '../../src/config/configuration';
import { RESEND_PLATFORM_SETTING_KEYS } from '../../src/email/constants/resend-settings.constants';
import { CredentialEncryptionPort } from '../../src/platform-admin/platform-settings/ports/credential-encryption.port';

export interface TestAppContext {
  app: INestApplication<App>;
  prisma: PrismaService;
}

/**
 * GOS-30/31/32 Slice 2 — `ADMIN_CREDENTIALS_ENCRYPTION_KEY`. Deliberately
 * ALWAYS a freshly-generated, synthetic 32-byte base64 key when the
 * environment doesn't already have one set — NEVER read from `.env`, NEVER
 * a real value. This runs once, at module-import time, i.e. BEFORE
 * `ConfigModule.forRoot()` (inside `AppModule`, loaded lazily during
 * `.compile()` below) ever parses `.env` — since `dotenv`'s own default
 * behavior never overrides an already-set `process.env` value, this
 * synthetic key wins over whatever (if anything) `.env` happens to define,
 * for every e2e test in this run. `jest-e2e.json` pins `maxWorkers: 1`, so
 * every spec file in a given run shares this one synthetic key — safe,
 * since no real secret is ever involved and every credential
 * encrypted/decrypted in e2e tests round-trips within the same run.
 */
if (!process.env.ADMIN_CREDENTIALS_ENCRYPTION_KEY) {
  process.env.ADMIN_CREDENTIALS_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
}

/**
 * Builds a real Nest application (`AppModule`, real Postgres via Prisma,
 * real Redis via `@nestjs/throttler`) for GraphQL e2e tests — same pattern
 * as the pre-existing `test/app.e2e-spec.ts`. Also replicates `main.ts`'s
 * global `ValidationPipe`, since `TestingModule`/`createNestApplication()`
 * bypasses `main.ts`'s own `bootstrap()`.
 *
 * `socialAuthProviderConfig`, when provided, overrides
 * `SOCIAL_AUTH_PROVIDER_CONFIG` so `socialLogin` tests can point at a
 * locally-served JWKS instead of real Google/Apple infrastructure — this is
 * the DI seam described in the GOS-22 plan.
 *
 * `graphqlIntrospectionEnabled`, when provided, overrides
 * `GRAPHQL_INTROSPECTION_ENABLED` for this app instance only (restored
 * immediately after `compile()`/`init()`, so it never leaks into other
 * spec files sharing this Jest worker process). Leave unset to get the
 * real default (`false` — see `src/config/configuration.ts`), which is
 * what most e2e tests should do. `admin-schema-isolation.e2e-spec.ts`
 * passes `true` because it needs to query `__schema`; the
 * `graphql-introspection.e2e-spec.ts` suite explicitly asserts the `false`
 * default. Works because `GraphQLModule.forRootAsync()`'s factory (see
 * `src/app.module.ts`) reads `ConfigService` lazily, during
 * `moduleBuilder.compile()` below — i.e. AFTER this env var is set, not at
 * `AppModule` import time.
 *
 * `adminPanelPath`, when provided, overrides `ADMIN_PANEL_PATH` (see
 * `src/config/configuration.ts`) for this app instance only, the same
 * restore-after-`compile()` pattern as `graphqlIntrospectionEnabled` above
 * — used by the security-hardening e2e coverage that proves a non-default
 * `ADMIN_PANEL_PATH` actually works end-to-end (static files + GraphQL
 * route), not just the default `/admin`.
 *
 * Also applies `applySecurityMiddleware()` (scoped CORS + helmet) —
 * identical to what `main.ts`'s `bootstrap()` applies to the real process —
 * since `TestingModule`/`createNestApplication()` bypasses `main.ts`
 * entirely, same reasoning as the `ValidationPipe` replication below.
 *
 * `.overrideProvider(AbstractLoader).useClass(ExpressLoader)` below is a
 * required workaround, NOT an arbitrary choice: `@nestjs/serve-static`'s
 * own `AbstractLoader` provider (see its `serve-static.providers.ts`)
 * picks its concrete loader via a factory that inspects
 * `HttpAdapterHost.httpAdapter` — but that factory runs eagerly during
 * `Test.createTestingModule({...}).compile()`, i.e. BEFORE
 * `moduleFixture.createNestApplication()` (the call that actually creates
 * and assigns the real Express adapter) has even run. At `.compile()` time
 * `httpAdapterHost.httpAdapter` is still `undefined`, so the factory falls
 * back to a `NoopLoader` that silently registers nothing — every static
 * route 404s — with NO error, NO warning, anywhere. Confirmed by
 * monkey-patching `ExpressLoader.register` in a throwaway spec: it was
 * never called at all without this override, and starts working the moment
 * the override is added. This only affects the `TestingModule`-based test
 * harness — a real process built via `NestFactory.create()` (this app's
 * actual `main.ts`) creates the adapter BEFORE the DI container resolves
 * providers, so it never hits this ordering bug; manually verified via
 * `curl` against a running `npm run start` (see the final report). Forcing
 * `ExpressLoader` here is safe because this app is unconditionally
 * Express-based (`@nestjs/platform-express`) in every environment,
 * including tests — never Fastify.
 */
export async function createTestApp(options?: {
  socialAuthProviderConfig?: SocialAuthProviderConfigMap;
  graphqlIntrospectionEnabled?: boolean;
  adminPanelPath?: string;
}): Promise<TestAppContext> {
  const previousIntrospectionEnv = process.env.GRAPHQL_INTROSPECTION_ENABLED;
  if (options?.graphqlIntrospectionEnabled !== undefined) {
    process.env.GRAPHQL_INTROSPECTION_ENABLED = String(
      options.graphqlIntrospectionEnabled,
    );
  }

  const previousAdminPanelPathEnv = process.env.ADMIN_PANEL_PATH;
  if (options?.adminPanelPath !== undefined) {
    process.env.ADMIN_PANEL_PATH = options.adminPanelPath;
  }

  try {
    let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AbstractLoader)
      .useClass(ExpressLoader);

    if (options?.socialAuthProviderConfig) {
      moduleBuilder = moduleBuilder
        .overrideProvider(SOCIAL_AUTH_PROVIDER_CONFIG)
        .useValue(options.socialAuthProviderConfig);
    }

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    // `rawBody: true` — mirrors `main.ts`'s own bootstrap option (see that
    // file's comment): needed so e2e coverage of `DiditWebhookController`'s
    // signature verification can exercise the REAL body-parsing pipeline,
    // not a mock. `TestingModule`/`createNestApplication()` bypasses
    // `main.ts` entirely, same reasoning as the `ValidationPipe`/
    // `applySecurityMiddleware` replication below.
    const app = moduleFixture.createNestApplication<INestApplication<App>>({
      rawBody: true,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    applySecurityMiddleware(app, app.get(ConfigService<AppConfig, true>));
    await app.init();

    const prisma = app.get(PrismaService);
    return { app, prisma };
  } finally {
    if (options?.graphqlIntrospectionEnabled !== undefined) {
      if (previousIntrospectionEnv === undefined) {
        delete process.env.GRAPHQL_INTROSPECTION_ENABLED;
      } else {
        process.env.GRAPHQL_INTROSPECTION_ENABLED = previousIntrospectionEnv;
      }
    }
    if (options?.adminPanelPath !== undefined) {
      if (previousAdminPanelPathEnv === undefined) {
        delete process.env.ADMIN_PANEL_PATH;
      } else {
        process.env.ADMIN_PANEL_PATH = previousAdminPanelPathEnv;
      }
    }
  }
}

/** Deletes all users-module domain rows — child tables first (FK). */
export async function cleanUsersData(prisma: PrismaService): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.emailVerificationCode.deleteMany();
  await prisma.passwordResetCode.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Deletes all profiles-module rows that are children of `User` — child
 * tables first (FK order). Does NOT delete `Category` rows (the seeded,
 * read-only catalog) — call this before `cleanUsersData`, whose
 * `user.deleteMany()` would otherwise fail on the `CustomerProfile`/
 * `ProfessionalProfile` FK.
 */
export async function cleanProfilesData(prisma: PrismaService): Promise<void> {
  await prisma.professionalSpecialization.deleteMany();
  await prisma.professionalProfile.deleteMany();
  await prisma.customerProfile.deleteMany();
}

/**
 * GOS-41 — deletes all `quotes`/`engagements`-module rows, in FK-safe order
 * (`Engagement` first — it references both `ServiceRequest` and `Quote` —
 * then `Quote`). Call BEFORE `cleanServiceRequestsData` below. Strictly
 * speaking every one of these FKs is `onDelete: Cascade` toward
 * `ServiceRequest` (see the GOS-41 plan's decision #12), so
 * `cleanServiceRequestsData`'s own `serviceRequest.deleteMany()` would
 * sweep these away too — this explicit helper exists anyway, same
 * "independently callable, matches every other `clean*Data` helper's own
 * convention" reasoning `cleanIdentityVerificationData` already documents
 * for its own Cascade-redundant cleanup.
 */
export async function cleanQuotesAndEngagementsData(
  prisma: PrismaService,
): Promise<void> {
  await prisma.engagement.deleteMany();
  await prisma.quote.deleteMany();
}

/**
 * Deletes all service-requests-module rows — child tables first (FK order).
 * Call `cleanQuotesAndEngagementsData` above BEFORE this (Engagement/Quote
 * both reference `ServiceRequest`). Call this BEFORE
 * `cleanProfilesData`/`cleanUsersData`, whose
 * `customerProfile.deleteMany()`/`user.deleteMany()` would otherwise fail
 * on the `ServiceRequest.customerProfileId`/
 * `ServiceRequestAttachmentUploadRef.userId` FKs.
 */
export async function cleanServiceRequestsData(
  prisma: PrismaService,
): Promise<void> {
  await prisma.serviceRequestAttachment.deleteMany();
  await prisma.serviceRequestAttachmentUploadRef.deleteMany();
  await prisma.serviceRequest.deleteMany();
}

/**
 * Deletes every `IdentityVerification` row — call before `cleanUsersData`
 * (whose `user.deleteMany()` would otherwise cascade-delete these anyway
 * via `onDelete: Cascade`, but an explicit, ordered cleanup here matches
 * every other `clean*Data` helper's own convention of being independently
 * callable).
 */
export async function cleanIdentityVerificationData(
  prisma: PrismaService,
): Promise<void> {
  await prisma.identityVerification.deleteMany();
}

/**
 * Deletes every `identity.*` `PlatformSetting` row — scoped cleanup, same
 * reasoning as `cleanPlatformSettingsData` (this codebase's generic
 * key-list version, reused here with the exact key list
 * `enableTestIdentityVerification` below writes).
 */
export const IDENTITY_VERIFICATION_TEST_SETTING_KEYS = [
  'identity.enabled',
  'identity.didit.enabled',
  'identity.didit.mode',
  'identity.didit.sandbox.api-key',
  'identity.didit.sandbox.workflow-id',
  'identity.didit.sandbox.webhook-secret',
];

/**
 * A CLEARLY SYNTHETIC, non-real Didit sandbox `webhook-secret` — never a
 * real credential. Exported (not just used internally) so e2e specs that
 * need to compute a matching `X-Signature-V2` HMAC over their own webhook
 * fixture bodies can reuse the exact same value
 * `DiditIdentityVerificationAdapter.verifyWebhookSignature` will read back
 * out of `PlatformSettingPort`.
 */
export const TEST_DIDIT_WEBHOOK_SECRET = 'e2e-test-webhook-secret';

/**
 * Upserts the `identity.*` `PlatformSetting` rows to a known-good,
 * ENABLED-and-fully-configured SANDBOX baseline — since 2026-08-15 (removal
 * of the former per-country `identity.routing.<country>.enabled` switches)
 * there is nothing country-specific left to configure here at all: both AR
 * and CO (and every other `CountryCode` value) resolve to the same Didit
 * adapter once the two global switches below are on — same
 * "explicitly opt this baseline IN, idempotent upsert" pattern as
 * `enableTestEmailDelivery`. `identity.didit.sandbox.api-key`/
 * `.workflow-id` are synthetic placeholders — `DiditIdentityVerificationAdapter.
 * createSession` itself is ALWAYS mocked at the `global.fetch` level by any
 * e2e spec that exercises the happy path (see that spec's own setup); no
 * e2e test in this codebase ever calls the real `verification.didit.me`.
 *
 * Takes the running `app` (not just `prisma`) so the two ENCRYPTED rows
 * (`api-key`/`webhook-secret`) can be encrypted via the SAME
 * `CredentialEncryptionPort` instance/key the app itself will decrypt them
 * with (`app.get(CredentialEncryptionPort)`) — hand-rolling fake
 * ciphertext/iv/authTag bytes here would fail `PrismaPlatformSettingAdapter.
 * getValue()`'s real AES-GCM decrypt (wrong auth tag) the moment the app
 * tries to read them back.
 */
export async function enableTestIdentityVerification(
  app: INestApplication,
  prisma: PrismaService,
): Promise<void> {
  const credentialEncryptionPort = app.get(CredentialEncryptionPort);
  const rows: {
    key: string;
    description: string;
    valueType: 'BOOLEAN' | 'STRING';
    value: string;
  }[] = [
    {
      key: 'identity.enabled',
      description: 'Global identity verification kill switch.',
      valueType: 'BOOLEAN',
      value: 'true',
    },
    {
      key: 'identity.didit.enabled',
      description: 'Didit provider kill switch.',
      valueType: 'BOOLEAN',
      value: 'true',
    },
    {
      key: 'identity.didit.mode',
      description: 'Active Didit credential set (SANDBOX or PRODUCTION).',
      valueType: 'STRING',
      value: 'SANDBOX',
    },
    {
      key: 'identity.didit.sandbox.workflow-id',
      description: 'Didit sandbox workflow-id.',
      valueType: 'STRING',
      value: 'e2e-test-workflow-id',
    },
  ];

  for (const row of rows) {
    await prisma.platformSetting.upsert({
      where: { key: row.key },
      update: {
        isEncrypted: false,
        isPublic: false,
        value: row.value,
        ciphertext: null,
        iv: null,
        authTag: null,
        maskedPreview: null,
        provider: null,
      },
      create: {
        key: row.key,
        description: row.description,
        valueType: row.valueType,
        isEncrypted: false,
        isPublic: false,
        value: row.value,
      },
    });
  }

  // `api-key`/`webhook-secret` are the two ENCRYPTED credentials — each
  // actually run through `credentialEncryptionPort.encrypt()` (real
  // AES-256-GCM, the app's own instance/key — see this function's own
  // header comment), so `PrismaPlatformSettingAdapter.getValue()` can
  // successfully decrypt them back when the app under test reads them.
  const encryptedApiKey = credentialEncryptionPort.encrypt(
    'e2e-test-sandbox-api-key',
  );
  await prisma.platformSetting.upsert({
    where: { key: 'identity.didit.sandbox.api-key' },
    update: {
      isEncrypted: true,
      isPublic: false,
      value: null,
      ciphertext: encryptedApiKey.ciphertext,
      iv: encryptedApiKey.iv,
      authTag: encryptedApiKey.authTag,
      maskedPreview: credentialEncryptionPort.maskedPreview(
        'e2e-test-sandbox-api-key',
      ),
      provider: null,
    },
    create: {
      key: 'identity.didit.sandbox.api-key',
      description: 'Didit sandbox api-key.',
      valueType: 'STRING',
      isEncrypted: true,
      isPublic: false,
      ciphertext: encryptedApiKey.ciphertext,
      iv: encryptedApiKey.iv,
      authTag: encryptedApiKey.authTag,
      maskedPreview: credentialEncryptionPort.maskedPreview(
        'e2e-test-sandbox-api-key',
      ),
    },
  });

  const encryptedWebhookSecret = credentialEncryptionPort.encrypt(
    TEST_DIDIT_WEBHOOK_SECRET,
  );
  await prisma.platformSetting.upsert({
    where: { key: 'identity.didit.sandbox.webhook-secret' },
    update: {
      isEncrypted: true,
      isPublic: false,
      value: null,
      ciphertext: encryptedWebhookSecret.ciphertext,
      iv: encryptedWebhookSecret.iv,
      authTag: encryptedWebhookSecret.authTag,
      maskedPreview: credentialEncryptionPort.maskedPreview(
        TEST_DIDIT_WEBHOOK_SECRET,
      ),
      provider: null,
    },
    create: {
      key: 'identity.didit.sandbox.webhook-secret',
      description: 'Didit sandbox webhook-secret.',
      valueType: 'STRING',
      isEncrypted: true,
      isPublic: false,
      ciphertext: encryptedWebhookSecret.ciphertext,
      iv: encryptedWebhookSecret.iv,
      authTag: encryptedWebhookSecret.authTag,
      maskedPreview: credentialEncryptionPort.maskedPreview(
        TEST_DIDIT_WEBHOOK_SECRET,
      ),
    },
  });
}

/**
 * Deletes every platform-admin (GOS-30/31/32) `AdminUser`-owned row —
 * child tables first (FK order) — but deliberately does NOT delete
 * `AdminRole` rows (a small, effectively-fixed seeded catalog, same
 * reasoning as `Category` above) or `PlatformSetting` rows (shared,
 * seed-owned data other suites — e.g. `auth-social-login.e2e-spec.ts` —
 * also depend on existing with their seeded defaults).
 */
export async function cleanAdminUsersData(
  prisma: PrismaService,
): Promise<void> {
  await prisma.adminAuditLog.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
}

/**
 * Deletes `PlatformSetting` rows matching the given `key`s only — NOT a
 * blanket `deleteMany()` — same scoped-cleanup reasoning as
 * `cleanAdminUsersData` leaving the seeded settings alone: the
 * `customer.social-login.<provider>.enabled`/`.client-id` rows are shared,
 * seeded-ish baseline data other suites (`test/auth-social-login.e2e-spec.ts`)
 * depend on existing; a dedicated settings e2e suite should use its own
 * uniquely-keyed test row(s) instead (mirrors `TEST_SETTING_KEY` in
 * `admin-platform-settings.e2e-spec.ts`), and pass those same keys here to
 * clean up after itself without touching the shared rows.
 */
export async function cleanPlatformSettingsData(
  prisma: PrismaService,
  keys: string[],
): Promise<void> {
  await prisma.platformSetting.deleteMany({ where: { key: { in: keys } } });
}

/**
 * A CLEARLY SYNTHETIC, non-real Resend API key — never a real credential.
 * Long enough to look plausible in a UI screenshot; never actually sent to
 * Resend's API by anything in this e2e suite (no test in this codebase
 * exercises `ResendEmailClientAdapter.send()` against the real Resend API —
 * `VerificationCodeSenderPort`/`PasswordResetEmailSenderPort` only ever
 * enqueue a BullMQ job in these tests, never actually processed by a
 * running worker in the e2e process).
 */
const TEST_RESEND_API_KEY = 're_test_00000000000000000000000000';

/**
 * Upserts the `notifications.email.resend.*` `PlatformSetting`
 * rows to a known-good, ENABLED-and-fully-configured baseline — GOS-3x
 * follow-up (2026-08-10): `register`/`resendVerificationCode`/
 * `requestPasswordReset` now all call `EnsureEmailDeliveryAvailableService`
 * FIRST (see that service's own doc comment), and `prisma/seed.ts`
 * deliberately seeds `enabled: 'false'` (fail-closed, no real key to seed
 * alongside it) — so, unlike the social-login flags (seeded `true` by
 * default), every e2e suite that exercises one of those 3 mutations must
 * explicitly opt this baseline IN for itself first, same idempotent-upsert
 * pattern `auth-social-login.e2e-spec.ts`'s `upsertClientIdCredential`
 * already uses for the analogous social-login credential. Never a real
 * value — see `TEST_RESEND_API_KEY`'s own comment.
 */
export async function enableTestEmailDelivery(
  prisma: PrismaService,
): Promise<void> {
  const rows: {
    key: string;
    description: string;
    valueType: 'BOOLEAN' | 'STRING';
    value: string;
  }[] = [
    {
      key: RESEND_PLATFORM_SETTING_KEYS.enabled,
      description: 'Gates the Resend transactional-email provider.',
      valueType: 'BOOLEAN',
      value: 'true',
    },
    {
      key: RESEND_PLATFORM_SETTING_KEYS.apiKey,
      description: 'Resend API key.',
      valueType: 'STRING',
      value: TEST_RESEND_API_KEY,
    },
    {
      key: RESEND_PLATFORM_SETTING_KEYS.fromAddress,
      description: 'Resend from-address.',
      valueType: 'STRING',
      value: 'noreply@e2e-test.example.com',
    },
    {
      key: RESEND_PLATFORM_SETTING_KEYS.fromName,
      description: 'Resend from-name.',
      valueType: 'STRING',
      value: 'GoService E2E',
    },
  ];

  for (const row of rows) {
    await prisma.platformSetting.upsert({
      where: { key: row.key },
      // `isPublic: false` is explicitly re-asserted here too, not left out
      // like a plain "only touch what this helper cares about" update would
      // be tempted to do. Real-world incident (2026-08-11): this row's
      // `isPublic` had been flipped to `true` by hand at some point (e.g.
      // exploring the admin panel), and because this `update` branch used to
      // leave `isPublic` untouched, that stale `true` silently survived
      // every subsequent e2e run forever — even though NOTHING here ever
      // intended these `notifications.email.resend.*` settings (backend-only
      // credentials/config; the mobile app never reads this branch of
      // `platformConfig`) to be public. Re-asserting the correct value on
      // every run makes this baseline self-healing instead of merely
      // idempotent for the fields it happens to list.
      //
      // A SECOND real-world incident, same day: `ciphertext`/`iv`/`authTag`/
      // `maskedPreview`/`provider` are ALSO explicitly reset to `null` here
      // now — this row's `isEncrypted` had ALSO been flipped to `true` by
      // hand at some point (e.g. exploring the admin panel's "encrypt this
      // setting" option), which left `ciphertext`/`iv`/`authTag` populated.
      // The `update` branch used to leave those columns untouched too, so
      // setting `isEncrypted: false` here without also clearing them
      // violated `platform_setting_encrypted_shape_check` (isEncrypted:
      // false requires ciphertext/iv/authTag/maskedPreview/provider to all
      // be null) — a hard Postgres error, not a silent bug, but one that
      // broke EVERY e2e suite calling this helper until fixed. Same
      // "explicitly reset every field this baseline owns, don't just touch
      // the ones convenient for the common case" principle as the
      // `isPublic` fix above, now actually covering every column the
      // CHECK constraint cares about.
      update: {
        isEncrypted: false,
        isPublic: false,
        value: row.value,
        ciphertext: null,
        iv: null,
        authTag: null,
        maskedPreview: null,
        provider: null,
      },
      create: {
        key: row.key,
        description: row.description,
        valueType: row.valueType,
        isEncrypted: false,
        isPublic: false,
        value: row.value,
      },
    });
  }
}
