import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const deleted = await prisma.platformSetting.deleteMany({
    where: { key: 'customer.social-login.apple.enabled' },
  });
  console.log('deleted rows:', deleted.count);
  await prisma.$disconnect();
}

main();
