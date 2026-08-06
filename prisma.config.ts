import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 6 deprecates `package.json#prisma` in favor of this file (removed
// entirely in Prisma 7 — see https://pris.ly/prisma-config). Once a
// `prisma.config.ts` exists, Prisma no longer auto-loads `.env` for you, so
// `DATABASE_URL` (referenced by `env("DATABASE_URL")` in schema.prisma)
// must be loaded explicitly before `defineConfig` runs. `process.loadEnvFile`
// is Node's own built-in .env loader (stable since Node 20.6, no new
// dependency) — deliberately not `dotenv/config`, which is only ever a
// transitive dependency here (via @nestjs/config), never one this project
// declares directly.
process.loadEnvFile(path.join(__dirname, '.env'));

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    // Same command previously under package.json#prisma.seed — see
    // prisma/seed.ts for what it seeds and why.
    seed: 'ts-node --compiler-options {"module":"CommonJS","moduleResolution":"node"} prisma/seed.ts',
  },
});
