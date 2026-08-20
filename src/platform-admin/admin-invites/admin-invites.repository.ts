import { Injectable } from '@nestjs/common';
import { AdminInvite, AdminUser, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `AdminInvite` — mirrors `PasswordResetRepository`'s role for
 * `PasswordResetCode`. Never returns the raw token (it isn't stored — only
 * `tokenHash` is; see `admin-invite-token.util.ts`).
 */
@Injectable()
export class AdminInvitesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The AdminUser's most recent, still-usable (not consumed/invalidated —
   * regardless of expiry, same "callers decide how to treat expiry"
   * reasoning as `PasswordResetRepository.findActivePasswordResetCode`)
   * invite, if any. */
  findActiveByAdminUserId(adminUserId: string): Promise<AdminInvite | null> {
    return this.prisma.adminInvite.findFirst({
      where: { adminUserId, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** `acceptAdminInvite`'s lookup — includes the owning `AdminUser` (full
   * row, including `passwordHash`/`status`) since `AcceptAdminInviteService`
   * needs both to activate the account. Never exposed via GraphQL directly —
   * this repository method is only ever consumed by that one service. */
  findByTokenHash(
    tokenHash: string,
  ): Promise<(AdminInvite & { adminUser: AdminUser }) | null> {
    return this.prisma.adminInvite.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });
  }

  create(data: {
    adminUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AdminInvite> {
    return this.prisma.adminInvite.create({ data });
  }

  invalidate(id: string): Promise<AdminInvite> {
    return this.prisma.adminInvite.update({
      where: { id },
      data: { invalidatedAt: new Date() },
    });
  }

  /** Runs inside the caller's own `$transaction`
   * (`AcceptAdminInviteService`) — the `AdminInvite` consume and the
   * `AdminUser` activation commit atomically or not at all. */
  consume(tx: Prisma.TransactionClient, id: string): Promise<AdminInvite> {
    return tx.adminInvite.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }
}
