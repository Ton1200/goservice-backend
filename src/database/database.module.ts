import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Pilot-scoped persistence module.
 *
 * Deliberate pilot decision (NOT a final architecture choice): this module
 * wraps the plain `pg` driver (`Pool`) directly — no ORM, no query builder,
 * no repository abstraction. See ADR 0002/0003 open questions
 * (goservice-docs/architecture/adr/) — the ORM/persistence-library choice
 * remains open and must go through its own ADR before any real domain
 * module is built on top of this.
 */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
