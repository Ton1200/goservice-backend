/**
 * Test-only environment wiring for `npm run test:e2e`.
 *
 * Points every e2e run at the dedicated `postgres_test` Docker service (see
 * `docker-compose.yml` at the repo root), NEVER at the `postgres` (dev)
 * service. This is the actual fix for a real incident (2026-08-11):
 * `npm run test:e2e` used to share the real dev Postgres and wiped real
 * user data once. `postgres_test` is expected to be wiped/recreated freely
 * by test runs; `postgres`/`goservice_dev` must never be touched by
 * automated tests again.
 *
 * Mechanism: a Jest `setupFiles` entry (see `test/jest-e2e.json`) runs
 * before any test file is loaded — and therefore before `AppModule`'s
 * `ConfigModule.forRoot({ envFilePath: '.env' })` is ever instantiated
 * (that only happens later, inside `Test.createTestingModule(...).compile()`
 * in `test/support/test-app.ts`/individual specs). `@nestjs/config`'s
 * underlying `dotenv` loader never overrides an already-set `process.env`
 * value, so setting these here BEFORE that point wins over whatever the
 * developer's own `goservice-backend/.env` (the DEV backend's env file)
 * happens to contain — no `.env.test` file is needed or used.
 *
 * (A `goservice-backend/.env.test` file was considered first, per this
 * change's own instructions, but this repo's tool-permission policy
 * unconditionally denies creating/editing any `.env*`-pattern file — see
 * `.claude/settings.json`'s `deny` list — so this setup-file mechanism is
 * used instead, an "or equivalent" the same instructions explicitly left
 * room for.)
 *
 * Credentials/DB name below are NOT real secrets: `goservice_test`/
 * `goservice_test_password` only exist for this throwaway, local,
 * Docker-only test database (see `docker-compose.yml`'s `postgres_test`
 * service, which hardcodes these same values rather than sourcing them from
 * the root `.env`) — same "clearly synthetic, non-real" pattern already
 * used by `TEST_RESEND_API_KEY`/`TEST_DIDIT_WEBHOOK_SECRET` in
 * `test/support/test-app.ts`.
 */

const TEST_DATABASE_HOST = 'localhost';
const TEST_DATABASE_PORT = '5433';
const TEST_DATABASE_NAME = 'goservice_test';
const TEST_DATABASE_USER = 'goservice_test';
const TEST_DATABASE_PASSWORD = 'goservice_test_password';

process.env.DATABASE_HOST = TEST_DATABASE_HOST;
process.env.DATABASE_PORT = TEST_DATABASE_PORT;
process.env.DATABASE_NAME = TEST_DATABASE_NAME;
process.env.DATABASE_USER = TEST_DATABASE_USER;
process.env.DATABASE_PASSWORD = TEST_DATABASE_PASSWORD;

// Prisma's own connection string (see prisma/schema.prisma's
// `datasource db { url = env("DATABASE_URL") }`) — additional and separate
// from the discrete DATABASE_HOST/PORT/NAME/USER/PASSWORD vars above, same
// distinction `env-validation.schema.ts` already documents for the
// non-test case.
process.env.DATABASE_URL = `postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${TEST_DATABASE_HOST}:${TEST_DATABASE_PORT}/${TEST_DATABASE_NAME}`;
