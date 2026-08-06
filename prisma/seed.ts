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

async function main(): Promise<void> {
  for (const name of CATEGORIES) {
    // upsert-on-name makes the seed itself idempotent/re-runnable.
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
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
