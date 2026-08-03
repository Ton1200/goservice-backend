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
   * Provider `aud` (audience) values expected when validating Google/Apple
   * identity tokens in `socialLogin` — see
   * `src/auth/adapters/jose-social-identity-validation.adapter.ts`.
   */
  socialAuth: {
    googleClientId: string | undefined;
    appleClientId: string | undefined;
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
   * Resend (transactional email delivery — see `src/email/`). Required in
   * every environment, including local dev — see ADR 0004.
   */
  email: {
    resendApiKey: string;
    fromAddress: string;
    fromName: string;
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:19006',
];

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_CORS_ALLOWED_ORIGINS;
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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
  socialAuth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    appleClientId: process.env.APPLE_CLIENT_ID,
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
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? '',
    fromName: process.env.EMAIL_FROM_NAME ?? 'GoService',
  },
});
