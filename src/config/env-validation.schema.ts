import * as Joi from 'joi';

/**
 * Minimal startup env-var validation for this infra pilot.
 *
 * Scope note: this is intentionally small — just the handful of vars this
 * pilot actually reads (see `configuration.ts`). It exists so a missing or
 * malformed required variable (e.g. no `DATABASE_HOST` at all, or an empty
 * `DATABASE_PASSWORD`) fails loudly and clearly at process startup — via
 * `ConfigModule.forRoot`'s `validationSchema`, which throws a
 * `Config validation error: ...` before the app finishes bootstrapping —
 * instead of silently falling back to a default (or an empty string) and
 * only surfacing as a confusing `databaseStatus: UNAVAILABLE` / auth-failure
 * log later, at first query time.
 *
 * Not a general-purpose config-validation abstraction: no nested schemas,
 * no custom validators beyond what Joi ships with. Defaults mirror the ones
 * already applied in `configuration.ts` for optional numeric vars — this
 * duplication is deliberate/harmless: it lets a bad *value* (e.g.
 * `DATABASE_PORT=not-a-number`) fail at startup too, rather than only being
 * caught by `configuration.ts`'s own `parsePort` fallback.
 */
export const envValidationSchema = Joi.object({
  PORT: Joi.number().integer().positive().default(3000),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().integer().positive().default(5432),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_USER: Joi.string().required(),
  // Required and non-empty: an unset password should fail clearly at
  // startup, not silently become `''` and fail PostgreSQL auth later.
  DATABASE_PASSWORD: Joi.string().min(1).required(),
  DATABASE_POOL_MAX: Joi.number().integer().positive().default(10),

  // Optional: comma-separated list of allowed CORS origins. Left unset in
  // most local setups — `configuration.ts` supplies safe localhost defaults
  // (Expo Web dev server ports) when this isn't provided.
  CORS_ALLOWED_ORIGINS: Joi.string().optional(),

  // GOS-22 additions below. See `configuration.ts` for how each is read and
  // the GOS-22 implementation plan for why each library/default was chosen.

  // Prisma CLI/Client connection string. Additional and separate from the
  // discrete DATABASE_HOST/PORT/NAME/USER/PASSWORD vars above, which remain
  // owned by the pre-existing `src/database/` pilot `pg.Pool` wrapper and
  // are not replaced by this.
  DATABASE_URL: Joi.string().required(),

  // Redis, used only by @nestjs/throttler for rate-limiting counters.
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().integer().positive().default(6379),
  // `.allow('')`: an empty value is the normal way to express "local Redis
  // with no auth" in a .env file — Joi's `.optional()` alone only allows
  // the var to be ABSENT, not empty, and would otherwise reject a
  // deliberately-blank `REDIS_PASSWORD=` line at startup.
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // GOOGLE_CLIENT_ID/APPLE_CLIENT_ID were removed here (GOS-30/31/32
  // Slice 2): the `aud` claim `socialLogin` validates against now comes
  // from an encrypted `PlatformCredential` row
  // (`customer.social-login.<provider>.client-id`), read at request time
  // via `PlatformCredentialPort` — see
  // `src/auth/adapters/jose-social-identity-validation.adapter.ts`. Not an
  // env var at all anymore, so there is nothing to validate here.

  // Email-verification-code policy — proposals adopted as a working
  // assumption (see `src/users/services/register-user.service.ts`), not
  // confirmed business rules.
  EMAIL_VERIFICATION_CODE_TTL_MINUTES: Joi.number()
    .integer()
    .positive()
    .default(15),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(60),
  EMAIL_VERIFICATION_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),

  // GOS-7 session policy — explicit placeholder default (30 days), not a
  // confirmed product policy. See
  // `src/auth/adapters/postgres-session.adapter.ts`.
  SESSION_TTL_HOURS: Joi.number().integer().positive().default(720),

  // RESEND_API_KEY/EMAIL_FROM_ADDRESS/EMAIL_FROM_NAME were REMOVED here
  // (GOS-3x follow-up, 2026-08-10): Resend's api-key/from-address/from-name,
  // plus a new enable/disable gate, are now admin-managed `PlatformSetting`
  // rows (`notifications.email.resend.*`) instead of env vars —
  // see `src/email/constants/resend-settings.constants.ts`,
  // `src/email/services/ensure-email-delivery-available.service.ts`, and
  // `src/email/adapters/resend-email-client.adapter.ts`, which now reads
  // them live via `PlatformSettingPort` on every send, not once at process
  // startup. This schema's root `.unknown(true)` (see the bottom of this
  // file) means a developer's own local `.env` may still physically
  // contain these three vars without failing validation — they are simply
  // no longer read by anything.

  // Password-reset-code policy (GOS-9) — same shape/defaults as the
  // EMAIL_VERIFICATION_* vars above, applied to the new `PasswordResetCode`
  // entity. See `src/password-reset/services/reset-password.service.ts`.
  PASSWORD_RESET_CODE_TTL_MINUTES: Joi.number()
    .integer()
    .positive()
    .default(15),
  PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(60),
  PASSWORD_RESET_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),

  // GOS-30/31/32 (platform-admin, Slice 1). ADMIN_SESSION_TTL_MINUTES has a
  // safe default so the app boots without it. The three ADMIN_BOOTSTRAP_*
  // vars are deliberately `.optional()` here — they are read ONLY by
  // `scripts/bootstrap-super-admin.ts`, never by the running app, and that
  // script itself validates their presence explicitly when actually
  // invoked, rather than making every environment (including ones that
  // never run the bootstrap script) require them at startup.
  ADMIN_SESSION_TTL_MINUTES: Joi.number().integer().positive().default(30),
  ADMIN_BOOTSTRAP_EMAIL: Joi.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: Joi.string().min(1).optional(),
  ADMIN_BOOTSTRAP_DISPLAY_NAME: Joi.string().min(1).optional(),

  // GOS-30/31/32 Slice 2 — AES-256-GCM key encrypting every
  // `PlatformCredential.ciphertext` at rest. Deliberately `.optional()`
  // here, same reasoning as the ADMIN_BOOTSTRAP_* vars above: it is only
  // actually needed the first time a `PlatformCredential` is written or
  // read (`setPlatformCredential`/`PlatformCredentialPort.getDecryptedValue`
  // — see `src/platform-admin/platform-credentials/adapters/aes-gcm-credential-encryption.adapter.ts`),
  // never at plain app startup, so requiring it unconditionally here would
  // break every environment that hasn't configured a credential yet.
  // MUST be a base64-encoded 256-bit (32-byte) key when actually used — the
  // adapter itself validates the decoded length/format lazily and fails
  // loudly (never logging the value) if malformed; this schema only
  // constrains it to a non-empty string so a truly blank value still fails
  // clearly rather than being silently treated as "unset".
  ADMIN_CREDENTIALS_ENCRYPTION_KEY: Joi.string().min(1).optional(),

  // Security-review fix (GraphQL introspection): defaults to `false` in
  // every environment where it isn't explicitly set — see
  // `configuration.ts`'s `graphqlIntrospectionEnabled` doc comment for why
  // this doesn't trust Apollo's own NODE_ENV-linked default. Boolean-shaped
  // but modeled as `Joi.string()` (not `Joi.boolean()`) deliberately: env
  // vars are always raw strings, and `configuration.ts`'s own `parseBoolean`
  // is the single place that interprets them — this schema only needs to
  // constrain it to the two valid literal values so a typo (e.g.
  // `TRUE`/`1`/`yes`) fails loudly at startup instead of silently being
  // read as `false` by `parseBoolean`.
  GRAPHQL_INTROSPECTION_ENABLED: Joi.string().valid('true', 'false').optional(),

  // Security-hardening addition: mount path for the platform-admin static
  // panel AND (derived from this same value) its isolated GraphQL endpoint
  // — see `configuration.ts`'s `adminPanelPath` doc comment for the full
  // rationale, including the "this is obscurity, not security, and the
  // default is NOT secret" caveat. Optional; `configuration.ts` supplies
  // the `/admin` default when unset. Constrained to a single leading-slash
  // path segment (letters/digits/`.`/`_`/`-`) so a malformed value (missing
  // slash, embedded `/graphql`, trailing slash, etc.) fails loudly at
  // startup instead of producing a broken/ambiguous route at runtime.
  ADMIN_PANEL_PATH: Joi.string()
    .pattern(/^\/[a-zA-Z0-9._-]+$/)
    .optional(),
}).unknown(true); // allow other, unrelated env vars (PATH, etc.) through untouched
