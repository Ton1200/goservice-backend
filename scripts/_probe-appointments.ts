// TEMPORARY diagnostic script — not part of the feature, delete after use.
import path from 'node:path';
process.loadEnvFile(path.join(__dirname, '..', '.env'));
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const engagements = await prisma.engagement.findMany({
    select: { id: true, customerProfileId: true, professionalProfileId: true },
    take: 5,
  });
  console.log('Engagements sample:', JSON.stringify(engagements, null, 2));

  for (const e of engagements) {
    const appts = await prisma.appointment.findMany({ where: { engagementId: e.id } });
    if (appts.length > 0) {
      console.log(`Engagement ${e.id} has ${appts.length} appointment(s):`);
      console.log(JSON.stringify(appts, null, 2));
    }
  }
}
main()
  .catch((err) => {
    console.error('PROBE ERROR:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
