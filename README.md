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
