import { Injectable } from '@nestjs/common';
import { AdminAuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminAuditLogWriteInput {
  actorAdminUserId: string;
  action: string;
  targetType: string;
  targetKey: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `AdminAuditLog`. Originally write-path-only for Slice 1 — `countByActor`
 * below (Administrators-tab follow-up, 2026-08-20) is the first real READ,
 * added specifically for `DeleteAdminUserService`'s pre-check. No resolver
 * exposes this table's contents yet (a full `auditLog` viewer query remains
 * unbuilt, see ADR 0005).
 *
 * `write()` deliberately takes a `Prisma.TransactionClient` (`tx`), never
 * `PrismaService` directly — every caller (starting with
 * `../feature-flags/services/set-feature-flag.service.ts`) is REQUIRED to
 * pass its own already-open `$transaction`'s client, so the audited write
 * and the audit-log row commit atomically or not at all. There is
 * deliberately no non-transactional overload for `write()`: an audit write
 * that could silently happen outside the mutation it's documenting would
 * defeat the whole point of auditing. `countByActor`, being a plain READ
 * with no write of its own to stay atomic with, uses the injected
 * `PrismaService` directly instead — no `tx` needed.
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  write(
    tx: Prisma.TransactionClient,
    input: AdminAuditLogWriteInput,
  ): Promise<AdminAuditLog> {
    return tx.adminAuditLog.create({
      data: {
        actorAdminUserId: input.actorAdminUserId,
        action: input.action,
        targetType: input.targetType,
        targetKey: input.targetKey,
        metadata: input.metadata,
      },
    });
  }

  /**
   * `DeleteAdminUserService`'s pre-check — `AdminAuditLog.actorAdminUser` is
   * `onDelete: Restrict` (see `prisma/schema.prisma`), so a real hard-delete
   * of an `AdminUser` who has EVER been the actor of any audited action is
   * physically impossible at the DB level, not just a business rule. This
   * lets the service reject with a friendly `ADMIN_USER_HAS_AUDIT_HISTORY`
   * (suggesting Revoke instead) BEFORE attempting the delete, same
   * "pre-check, then friendly error" convention `DeleteCategoryService`/
   * `DeleteAdminRoleService` already establish for their own `onDelete:
   * Restrict`-backed constraints, rather than surfacing a raw Postgres
   * foreign-key-violation error.
   */
  countByActor(adminUserId: string): Promise<number> {
    return this.prisma.adminAuditLog.count({
      where: { actorAdminUserId: adminUserId },
    });
  }
}
