import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { userAccountNotFound } from '../errors/user-account.errors';
import { DeleteUserAccountPayload } from '../models/delete-user-account-payload.model';

/**
 * Orchestrates `deleteUserAccount` (GOS-3x follow-up, hard-delete,
 * 2026-08-11) — a REAL, PERMANENT, IRREVERSIBLE deletion of the target
 * `User` row. REPLACES the prior round's `deactivateUserAccount` (reversible
 * soft-delete via `User.deletedAt`) entirely, at explicit, in-the-moment
 * human authorization — see ADR 0005's Tenth round for the full rationale:
 * this is a development/testing convenience to speed up manual QA, never a
 * production data-retention mechanism. A future account-lockout capability
 * will be a separate, new mechanism (most likely a status/flag), not a
 * revival of this one.
 *
 * Every `Session`/`EmailVerificationCode`/`PasswordResetCode`/
 * `CustomerProfile`/`ProfessionalProfile` (→ `ProfessionalSpecialization`)
 * the user owns is removed automatically by Postgres via each relation's own
 * `onDelete: Cascade` (see `prisma/schema.prisma`) — no application-level
 * cleanup needed here, unlike the former soft-delete's explicit
 * `SessionsRepository.revokeAllActiveForUser` step.
 *
 * The `AdminAuditLog` row is written BEFORE the `User` row is deleted, in
 * the SAME `$transaction`, capturing a minimal snapshot (`email`,
 * `hadCustomerProfile`, `hadProfessionalProfile`) since the row itself will
 * be gone forever once this commits — `AdminAuditLog.targetKey` is a plain
 * `String`, not a foreign key, so the audit trail survives intact even
 * though the `User` it refers to no longer exists.
 */
@Injectable()
export class DeleteUserAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async deleteUserAccount(
    adminUserId: string,
    id: string,
  ): Promise<DeleteUserAccountPayload> {
    const existing = await this.usersRepository.findByIdForAdmin(id);
    if (!existing) {
      throw userAccountNotFound(id);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'USER_ACCOUNT_DELETED',
        targetType: 'User',
        targetKey: id,
        metadata: {
          email: existing.email,
          hadCustomerProfile: existing.customerProfile !== null,
          hadProfessionalProfile: existing.professionalProfile !== null,
        },
      });

      await this.usersRepository.deleteForAdmin(tx, id);
    });

    return { success: true };
  }
}
