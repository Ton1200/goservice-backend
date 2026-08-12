/**
 * Central environment-variable loader for the pilot backend.
 *
 * Scope note: this is the ONLY place raw `process.env` values should be
 * read. Everything else in the app should depend on `ConfigService` so the
 * environment-variable naming scheme stays swappable without touching
 * business/application code.
 *
 * No real secrets live here — only defaults that are safe for local
 * development (and which intentionally do NOT match the real pilot
 * database password; see `.env.example`).
 */

export interface AppConfig {
  /** HTTP port the NestJS/GraphQL server listens on. */
  port: number;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    /** Max number of connections in the `pg` Pool. */
    poolMax: number;
  };
  /**
   * Origins allowed to call this API cross-origin (CORS), e.g. the Expo Web
   * dev server. Local-pilot scope only — no production origin policy here.
   * Defaults cover the two ports Expo Web has been observed to use
   * (`expo start --web` / `npx expo export --platform web` dev server on
   * 8081, and the older Expo CLI web default of 19006). Override/extend via
   * the comma-separated `CORS_ALLOWED_ORIGINS` env var.
   */
  corsAllowedOrigins: string[];
  redis: {
    host: string;
    port: number;
    /** Optional: unset for a local Redis with no password (dev default). */
    password: string | undefined;
  };
  /**
   * Email-verification-code policy (GOS-22). These defaults are proposals
   * adopted as a working assumption, not confirmed business rules — see
   * `src/users/services/register-user.service.ts`.
   */
  emailVerification: {
    codeTtlMinutes: number;
    resendCooldownSeconds: number;
    maxAttempts: number;
  };
  /**
   * Session policy (GOS-7). `ttlHours` default (720h = 30 days) is an
   * explicit placeholder, not a confirmed product policy — see
   * `src/auth/adapters/postgres-session.adapter.ts`.
   */
  session: {
    ttlHours: number;
  };
  /**
   * Password-reset-code policy (GOS-9). Same shape/defaults as
   * `emailVerification` by design — mirrors `EmailVerificationCode`'s policy
   * for the new `PasswordResetCode` entity. See
   * `src/password-reset/services/reset-password.service.ts`.
   */
  passwordReset: {
    codeTtlMinutes: number;
    resendCooldownSeconds: number;
    maxAttempts: number;
  };
  /**
   * Admin-session policy (GOS-30/31/32, Slice 1) — deliberately a SEPARATE,
   * much shorter TTL than the consumer `session.ttlHours` above (minutes,
   * not days): the admin panel manages feature flags and (later) encrypted
   * third-party credentials, so a much lower persistence window is a
   * deliberate trade-off — see
   * `src/platform-admin/admin-auth/adapters/postgres-admin-session.adapter.ts`.
   */
  adminSession: {
    ttlMinutes: number;
  };
  /**
   * Read ONLY by `scripts/bootstrap-super-admin.ts` — never by the running
   * NestJS app itself. Optional here (the app must still start without
   * them); the bootstrap script itself fails loudly if any is missing at
   * the point it actually needs them.
   */
  adminBootstrap: {
    email: string | undefined;
    password: string | undefined;
    displayName: string | undefined;
  };
  /**
   * AES-256-GCM key (base64-encoded 32 bytes) encrypting every
   * `PlatformCredential.ciphertext` at rest — see
   * `src/platform-admin/platform-credentials/adapters/aes-gcm-credential-encryption.adapter.ts`.
   * `undefined` until an operator actually sets it; the adapter validates
   * format and fails loudly, only at the point a credential is actually
   * written/read — see `env-validation.schema.ts`'s comment on
   * `ADMIN_CREDENTIALS_ENCRYPTION_KEY` for why this isn't required at plain
   * app startup.
   */
  adminCredentialsEncryptionKey: string | undefined;
  /**
   * Controls Apollo's GraphQL introspection (`__schema`/`__type`) on BOTH
   * `/graphql` and `/admin/graphql` — see `src/app.module.ts`. Defaults to
   * `false` unconditionally: Apollo Server itself defaults introspection to
   * "on whenever NODE_ENV !== 'production'", which is the same kind of
   * framework default this codebase already refuses to trust for
   * `includeStacktraceInErrorResponses` (see that flag's comment in
   * `app.module.ts`) — introspection left on in local/dev/test would still
   * leak the full schema (including the admin schema) to anyone who can
   * reach the endpoint. Local/dev setups that want introspection (e.g. for
   * GraphQL Playground/Voyager) must explicitly set
   * `GRAPHQL_INTROSPECTION_ENABLED=true` in their own `.env` — never commit
   * that as `true` in a shared/example file.
   */
  graphqlIntrospectionEnabled: boolean;
  /**
   * Mount path for the platform-admin static panel AND, derived from the
   * exact same value, its isolated GraphQL endpoint
   * (`${adminPanelPath}/graphql`) — see `src/app.module.ts`'s
   * `ServeStaticModule.forRootAsync()` and second `GraphQLModule.forRootAsync()`
   * registrations, both of which read this one field rather than two
   * independently-settable env vars. That's deliberate: an earlier
   * `exclude`/`path` MISMATCH (two values that were supposed to always
   * agree, but didn't) already caused a real bug once — static serving
   * shadowed the admin GraphQL route — see ADR 0005's `ServeStaticModule`
   * gotchas. A single source value that both the static mount and the
   * GraphQL path are computed from makes that class of drift structurally
   * impossible, rather than just "remembered."
   *
   * HONESTY NOTE — read this before treating this as a real security
   * control: this is OBSCURITY, not security, and only a mechanism for
   * obscurity, not obscurity itself. The default below (`/admin`) ships in
   * this repository's source and in `goservice-docs/architecture/infrastructure.md`,
   * so it is public knowledge, not a secret — anyone who has read this file
   * (or the docs) already knows the default path. Leaving `ADMIN_PANEL_PATH`
   * unset in a real deployment provides NO additional protection over the
   * unconditional default that shipped before this change existed. The only
   * way this setting does anything protective is if an operator sets a
   * non-default, non-guessable value in THAT DEPLOYMENT's own environment
   * (an untracked `.env` or equivalent secret-store entry) — never committed
   * to this repo, never reused across environments, and never treated as a
   * substitute for real authentication/authorization (which the admin panel
   * already has separately — see `src/platform-admin/admin-auth/`). Path
   * obscurity narrows exposure to automated scanners blindly probing
   * `/admin`; it does nothing against a targeted attacker who can enumerate
   * paths (e.g. via traffic inspection, a leaked link, or brute-forcing).
   */
  adminPanelPath: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:19006',
];

/** `.env` values are always strings — only the literal `'true'` enables. */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_CORS_ALLOWED_ORIGINS;
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const DEFAULT_ADMIN_PANEL_PATH = '/admin';

/**
 * Normalizes `ADMIN_PANEL_PATH` to a single, unambiguous shape (leading
 * slash, no trailing slash) so `${adminPanelPath}/graphql` composes
 * predictably wherever it's derived (see `AppConfig.adminPanelPath`'s doc
 * comment for the full rationale). `env-validation.schema.ts` additionally
 * rejects malformed values at startup — this function only handles
 * "unset"/"blank" (→ default) and cosmetic normalization, it does not
 * re-validate the shape.
 */
function parseAdminPanelPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_ADMIN_PANEL_PATH;
  }
  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

export default (): AppConfig => ({
  port: parsePort(process.env.PORT, 3000),
  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parsePort(process.env.DATABASE_PORT, 5432),
    name: process.env.DATABASE_NAME ?? 'goservice_dev',
    user: process.env.DATABASE_USER ?? 'goservice_dev',
    // Deliberately no hardcoded fallback for the password: an empty string
    // fails DB auth loudly (surfaced as `databaseStatus: UNAVAILABLE`)
    // rather than silently trying a guessed default.
    password: process.env.DATABASE_PASSWORD ?? '',
    poolMax: parsePort(process.env.DATABASE_POOL_MAX, 10),
  },
  corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parsePort(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD,
  },
  emailVerification: {
    codeTtlMinutes: parsePort(
      process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
      15,
    ),
    resendCooldownSeconds: parsePort(
      process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
      60,
    ),
    maxAttempts: parsePort(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS, 5),
  },
  session: {
    ttlHours: parsePort(process.env.SESSION_TTL_HOURS, 720),
  },
  passwordReset: {
    codeTtlMinutes: parsePort(process.env.PASSWORD_RESET_CODE_TTL_MINUTES, 15),
    resendCooldownSeconds: parsePort(
      process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
      60,
    ),
    maxAttempts: parsePort(process.env.PASSWORD_RESET_MAX_ATTEMPTS, 5),
  },
  adminSession: {
    ttlMinutes: parsePort(process.env.ADMIN_SESSION_TTL_MINUTES, 30),
  },
  adminBootstrap: {
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    displayName: process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME,
  },
  adminCredentialsEncryptionKey: process.env.ADMIN_CREDENTIALS_ENCRYPTION_KEY,
  graphqlIntrospectionEnabled: parseBoolean(
    process.env.GRAPHQL_INTROSPECTION_ENABLED,
    false,
  ),
  adminPanelPath: parseAdminPanelPath(process.env.ADMIN_PANEL_PATH),
});
