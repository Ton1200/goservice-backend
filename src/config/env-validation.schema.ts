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

  // Expected `aud` claim when validating Google/Apple identity tokens in
  // socialLogin. Required so a misconfigured deployment fails at startup
  // rather than accepting tokens meant for a different client.
  GOOGLE_CLIENT_ID: Joi.string().required(),
  APPLE_CLIENT_ID: Joi.string().required(),

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
}).unknown(true); // allow other, unrelated env vars (PATH, etc.) through untouched
