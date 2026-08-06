import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma-backed persistence for GoService domain data (first consumer:
 * `src/users/`).
 *
 * Deliberately separate from `src/database/` (the pre-existing infra-only
 * pilot's plain `pg.Pool` wrapper) — that module's own comment says
 * explicitly "no query methods for domain data belong here", so all real
 * domain persistence lives here instead. `src/database/` is not touched or
 * extended by this change.
 *
 * Prisma as the ORM here is a human-authorized, explicit deviation from the
 * "ORM is TBD, needs its own ADR" stance in
 * goservice-docs/architecture/backend.md — see the GOS-22 implementation
 * plan for the rationale. A follow-up ADR formalizing this project-wide is
 * recommended but not created as part of this change.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected from PostgreSQL cleanly.');
  }
}
