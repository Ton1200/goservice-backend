# GoService Backend

NestJS, TypeScript, GraphQL, and PostgreSQL backend for GoService.

This repository contains the modular monolith backend and its automated
tests. See the architecture and engineering documentation in the
`goservice-docs` repository, in particular:

- [`architecture/backend.md`](../goservice-docs/architecture/backend.md)
- [`architecture/graphql-contract.md`](../goservice-docs/architecture/graphql-contract.md)
- [`architecture/adr/0002-nestjs-graphql-backend.md`](../goservice-docs/architecture/adr/0002-nestjs-graphql-backend.md)
- [`architecture/adr/0003-postgresql-primary-database.md`](../goservice-docs/architecture/adr/0003-postgresql-primary-database.md)
- [`architecture/infrastructure.md`](../goservice-docs/architecture/infrastructure.md)
- [`workflows/local-development-environment.md`](../goservice-docs/workflows/local-development-environment.md) — the full connected-environment guide (Docker PostgreSQL, primary/validated path), covering this backend alongside `goservice-mobile/` and PostgreSQL.

## Current state: local technical pilot

This codebase is currently an **infra-only technical pilot** proving
end-to-end connectivity — Expo → GraphQL → NestJS → PostgreSQL — on a local
dev machine. It intentionally contains **no GoService domain entities**
(no `ServiceRequest`, `Quote`, `Engagement`, etc.) and **no ORM** yet; both
remain open questions tracked in ADR 0002/0003 and must go through their
own ADR before real domain modules are built.

Pilot-scoped decisions made so far (see comments in the referenced files
for full rationale — these are **not** final architecture decisions):

- **GraphQL driver**: Apollo (`@nestjs/apollo` + `@apollo/server`), code-first
  authoring via `@nestjs/graphql` decorators (see `src/app.module.ts`).
- **Persistence**: plain `pg` driver (`Pool`), no ORM (see
  `src/database/database.service.ts`).
- **Config**: `@nestjs/config`, loaded from a local `.env` (see
  `.env.example`).

## Requirements

- Node.js v24+ (verified against v24.13.0)
- A reachable PostgreSQL instance — see
  [`../goservice-docs/architecture/infrastructure.md`](../goservice-docs/architecture/infrastructure.md#local-postgresql--pilot-provisioning)
  for how the local pilot database was provisioned.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your local PostgreSQL credentials
```

## Running

```bash
npm run start:dev   # watch mode
npm run start        # single run
npm run build && npm run start:prod
```

The server listens on `http://localhost:$PORT` (default `3000`). The
GraphQL endpoint is at `http://localhost:$PORT/graphql`.

## Verifying the pilot

With the server running, query the infra health check:

```graphql
query {
  systemStatus {
    backendStatus
    databaseStatus
    serverTimestamp
  }
}
```

`databaseStatus` reflects a real `SELECT 1` executed against PostgreSQL at
request time (`OK` or `UNAVAILABLE`) — it is never hardcoded or faked, and
never leaks connection details or credentials on failure.

## CORS (local dev)

CORS is enabled (`app.enableCors(...)` in `src/main.ts`) so a browser-based
client — e.g. Expo Web on `http://localhost:8081` — can call `/graphql`
cross-origin; curl and Jest never exercised this because CORS is a
browser-only enforcement mechanism. The allowed origins default to
`http://localhost:8081` and `http://localhost:19006` (see
`src/config/configuration.ts`) and can be overridden with a comma-separated
`CORS_ALLOWED_ORIGINS` env var.

## Scripts

- `npm run build` — compile TypeScript
- `npm run start` / `start:dev` / `start:prod` — run the app
- `npm run lint` — ESLint
- `npm run test` — Jest unit tests
- `npm run test:e2e` — Jest e2e tests (spins up the Nest app in-process)
- `npm run admin:bootstrap` — one-time creation of the first SUPER_ADMIN (see below)
- `npm run admin:create-user` — create/update an admin user on demand (see below)

## Platform admin panel (GOS-30/31/32)

A separate, isolated admin capability lives in this same backend process:
a static HTML/CSS/vanilla-JS panel (`admin-panel/`) served by NestJS, that
talks exclusively to its own isolated GraphQL endpoint. It shares the same
PostgreSQL database as the consumer API, but has its own session/auth
mechanism, its own GraphQL schema (introspectable separately from
`/graphql`), and its own RBAC (`AdminRole`/`Permission`). See
[`../goservice-docs/architecture/adr/0005-platform-admin-isolated-graphql-endpoint.md`](../goservice-docs/architecture/adr/0005-platform-admin-isolated-graphql-endpoint.md)
for the full architecture rationale.

### Where to find it (`ADMIN_PANEL_PATH`)

Both the panel's static files and its GraphQL endpoint mount under one
configurable path segment:

- Panel UI: `http://localhost:$PORT${ADMIN_PANEL_PATH}/index.html`
- GraphQL endpoint: `http://localhost:$PORT${ADMIN_PANEL_PATH}/graphql`

`ADMIN_PANEL_PATH` defaults to `/admin` if unset — e.g. locally that's
`http://localhost:3000/admin/index.html`. This is obscurity, not a real
security boundary (the default is not secret) — real access control is the
admin session + RBAC layer, not the path. Must be a single path segment
starting with `/` (letters/digits/`.`/`_`/`-` only) — a malformed value
fails loudly at startup rather than producing a broken route.

### Creating an admin user

There is no self-service admin signup. Two scripts, for two different
moments:

1. **First admin ever, once per environment** — `npm run admin:bootstrap`.
   Reads `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` /
   `ADMIN_BOOTSTRAP_DISPLAY_NAME` from `.env`, seeds the fixed `AdminRole`
   catalog (`SUPER_ADMIN`/`CONFIG_MANAGER`/`SUPPORT_VIEWER`) if it doesn't
   exist yet, and creates exactly one `SUPER_ADMIN` — it's a no-op if a
   SUPER_ADMIN already exists. **Also re-run this any time the permission
   set for an existing role changes in `scripts/bootstrap-super-admin.ts`'s
   `ROLE_SEEDS`** — editing that source alone does NOT update the roles
   already stored in the database; the script's upsert is what actually
   applies the change, and it's safe to re-run any time.
   ```bash
   npm run admin:bootstrap
   ```

2. **Every admin after that, on demand** — `npm run admin:create-user`,
   with CLI flags (space-separated, not `--flag=value`):
   ```bash
   npm run admin:create-user -- --email someone@example.com --password 'Str0ng!Pass' --name "Jane Doe" --role CONFIG_MANAGER
   ```
   `--role` must already exist (created by `admin:bootstrap` above) —
   `SUPER_ADMIN`, `CONFIG_MANAGER`, or `SUPPORT_VIEWER`. Refuses to
   overwrite an existing admin matched by `--email` unless `--force` is
   also passed.

### Local environment

Nothing admin-specific is required to boot the app locally — every
admin-related env var below is optional with a safe default, so a fresh
clone still starts. To actually use the panel locally:

1. Set `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD`/`ADMIN_BOOTSTRAP_DISPLAY_NAME` in `.env`, run `npm run admin:bootstrap` once.
2. Open `http://localhost:3000/admin/index.html`, log in with those credentials.
3. Before storing any real encrypted credential (e.g. a Resend API key) via the panel, set `ADMIN_CREDENTIALS_ENCRYPTION_KEY` — a base64-encoded 256-bit key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Without it, `setPlatformSetting` fails loudly (not silently) the moment an encrypted value is written. It is **not** required just to boot the app or use non-secret settings/feature flags.
4. `GRAPHQL_INTROSPECTION_ENABLED=true` is commonly set locally (e.g. for GraphQL Playground / Postman exploration) — see the production note below for why this must never carry over.

### Production environment

Differences from local that matter before a real deploy:

- **`ADMIN_CREDENTIALS_ENCRYPTION_KEY` is effectively required** — generate a real key (same command as above) and store it as a real secret in whatever secret manager the deploy target uses. Never commit it, never reuse the local dev value.
- **`GRAPHQL_INTROSPECTION_ENABLED` must be unset or `false`** — it defaults to `false` when unset (fail-closed), but this is exactly the kind of local-only convenience flag that must not leak into a `.env`/deploy config copied from a dev machine. Applies to both `/graphql` and `${ADMIN_PANEL_PATH}/graphql`.
- **`CORS_ALLOWED_ORIGINS`** must list the real deployed mobile-web/admin-panel origin(s) — the default (`http://localhost:8081`, `http://localhost:19006`) only makes sense locally.
- **`ADMIN_BOOTSTRAP_*`** should only be set for the single deploy/run that performs the one-time bootstrap, then removed — leaving a real admin password sitting in a live environment's config after bootstrap is unnecessary residual exposure. Every subsequent admin goes through `admin:create-user` (run against the production database from a trusted operator machine/pipeline, not by exposing that script as a public endpoint — it isn't one).
- **`ADMIN_PANEL_PATH`** can stay at its default (`/admin`) — again, obscuring the path is not the real access control. Only change it if there's a specific operational reason to (e.g. avoiding a collision with another route).
