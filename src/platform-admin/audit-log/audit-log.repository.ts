import { Injectable } from '@nestjs/common';
import { AdminAuditLog, Prisma } from '@prisma/client';

export interface AdminAuditLogWriteInput {
  actorAdminUserId: string;
  action: string;
  targetType: string;
  targetKey: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Write path only for Slice 1 — the ONLY place in this codebase that
 * issues Prisma queries for `AdminAuditLog`. No resolver/query reads this
 * table yet (that's Slice 4's `auditLog` query).
 *
 * `write()` deliberately takes a `Prisma.TransactionClient` (`tx`), never
 * `PrismaService` directly — every caller (starting with
 * `../feature-flags/services/set-feature-flag.service.ts`) is REQUIRED to
 * pass its own already-open `$transaction`'s client, so the audited write
 * and the audit-log row commit atomically or not at all. There is
 * deliberately no non-transactional overload: an audit write that could
 * silently happen outside the mutation it's documenting would defeat the
 * whole point of auditing.
 */
@Injectable()
export class AuditLogRepository {
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
}
