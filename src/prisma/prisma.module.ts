import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so any domain module (starting with `src/users/`) can inject
 * `PrismaService` without every module re-importing it individually — the
 * same rationale NestJS's own docs give for marking a shared
 * database/connection module `@Global()`. Still a single, explicit
 * provider (no magic): see `prisma.service.ts`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
