import { Injectable } from '@nestjs/common';
import { AdminUser, AdminUserStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The exact set of `AdminUser` columns every admin-facing read (`adminUsers`
 * grid, `updateAdminUser`, `inviteAdminUser`, `resendAdminInvite`) is ever
 * allowed to return — DELIBERATELY excludes `passwordHash`, same structural
 * guardrail as `UsersRepository`'s own `ADMIN_USER_ACCOUNT_SELECT` for
 * consumer `User` rows.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  roleId: true,
  role: {
    select: {
      id: true,
      name: true,
      permissions: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminUserSelect;

export type AdminUserRow = Prisma.AdminUserGetPayload<{
  select: typeof ADMIN_USER_SELECT;
}>;

/**
 * The `AdminUser` read/write path for BOTH `adminLogin` (`findByEmail`,
 * returning the FULL row including `passwordHash` — needed to verify a
 * password) AND, since the Administrators-tab follow-up (2026-08-20), the
 * `adminUsers`/`updateAdminUser`/`inviteAdminUser`/`resendAdminInvite`
 * capability (`findById`/`findManyForAdmin`/`countAllForAdmin`/
 * `createInvited`/`updateForAdmin`, all `ADMIN_USER_SELECT`-shaped — never
 * `passwordHash`). No longer narrowly scoped to `findByEmail` alone, unlike
 * this file's own former header comment. Distinct from
 * `../admin-rbac/admin-roles.repository.ts`'s own `AdminUser` read (which
 * only ever selects `status`/`role.permissions` for permission checks) —
 * see that file's own header comment for why two repositories touching the
 * same table is acceptable here (both live inside `PlatformAdminModule`,
 * not across a module boundary).
 */
@Injectable()
export class AdminUsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { email } });
  }

  findById(id: string): Promise<AdminUserRow | null> {
    return this.prisma.adminUser.findUnique({
      where: { id },
      select: ADMIN_USER_SELECT,
    });
  }

  findManyForAdmin(params: {
    limit: number;
    offset: number;
  }): Promise<AdminUserRow[]> {
    return this.prisma.adminUser.findMany({
      select: ADMIN_USER_SELECT,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  countAllForAdmin(): Promise<number> {
    return this.prisma.adminUser.count();
  }

  /** Creates a fresh `INVITED` `AdminUser`, `passwordHash: null` — the
   * `inviteAdminUser` write, called BEFORE `IssueAdminInviteService` issues
   * the actual `AdminInvite` row (see `InviteAdminUserService`'s own header
   * comment for why this is a plain sequential `await`, not one big
   * `$transaction` spanning both). */
  createInvited(data: {
    email: string;
    displayName: string;
    roleId: string;
  }): Promise<AdminUserRow> {
    return this.prisma.adminUser.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        roleId: data.roleId,
        status: AdminUserStatus.INVITED,
        passwordHash: null,
      },
      select: ADMIN_USER_SELECT,
    });
  }

  /** Runs inside the caller's own `$transaction` (`UpdateAdminUserService`,
   * `AcceptAdminInviteService`) — same pattern as
   * `UsersRepository.updateForAdmin`. */
  updateForAdmin(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.AdminUserUpdateInput,
  ): Promise<AdminUserRow> {
    return tx.adminUser.update({
      where: { id },
      data,
      select: ADMIN_USER_SELECT,
    });
  }

  /**
   * `DeleteAdminUserService`'s actual delete — runs inside the caller's own
   * `$transaction`, AFTER `AuditLogRepository.countByActor` has already
   * confirmed zero `AdminAuditLog` rows reference this admin as actor (that
   * FK is `onDelete: Restrict`, so an unguarded call here would otherwise
   * throw a raw Postgres constraint violation for any admin with real audit
   * history). `AdminSession`/`AdminInvite` both cascade automatically.
   */
  delete(tx: Prisma.TransactionClient, id: string): Promise<AdminUser> {
    return tx.adminUser.delete({ where: { id } });
  }
}
