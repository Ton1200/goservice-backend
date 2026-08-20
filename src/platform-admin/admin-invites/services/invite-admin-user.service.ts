import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { adminRoleNotFound } from '../../admin-roles/errors/admin-role.errors';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { adminUserEmailTaken } from '../../admin-users/errors/admin-user.errors';
import { AdminUserModel } from '../../admin-users/models/admin-user.model';
import { toAdminUserModel } from '../../admin-users/models/to-admin-user-model.util';
import { InviteAdminUserInput } from '../models/invite-admin-user.input';
import { IssueAdminInviteService } from './issue-admin-invite.service';

/**
 * Orchestrates `inviteAdminUser`. Order:
 *   1. `EnsureEmailDeliveryAvailableService.ensureAvailable()` FIRST — mirrors
 *      `RegisterUserService.register()`/`ForceUserAccountPasswordResetService`
 *      exactly: this mutation cannot complete without a real invite email,
 *      so an unavailable email provider must fail loudly here rather than
 *      create an AdminUser who can never receive their invite.
 *   2. `email` must not already belong to an existing `AdminUser`
 *      (`ADMIN_USER_EMAIL_TAKEN`).
 *   3. `roleId` must reference an existing `AdminRole` (`ADMIN_ROLE_NOT_FOUND`).
 *   4. `AdminUsersRepository.createInvited` — status `INVITED`,
 *      `passwordHash: null`, a plain sequential `await`, DELIBERATELY NOT
 *      wrapped in one big `$transaction` with the invite-issuance step below
 *      — mirrors `RegisterUserService.register()`'s own already-accepted
 *      "sequential awaits, not one giant transaction" trade-off (creating
 *      the User row and issuing/emailing the verification code are likewise
 *      two separate awaits there, not one transaction).
 *   5. `IssueAdminInviteService.issueForAdminUser` — generates + persists +
 *      emails the invite token.
 *   6. Its OWN separate, minimal `$transaction` writing the `AdminAuditLog`
 *      row (`ADMIN_USER_INVITED`) — mirrors
 *      `ForceUserAccountPasswordResetService`'s exact audit-write shape (a
 *      real side-effect — an email enqueue — can't participate in a
 *      Postgres transaction anyway, so a separate minimal transaction for
 *      the DB-only audit row is simpler and still satisfies
 *      `AuditLogRepository.write`'s "always via an open transaction"
 *      invariant).
 */
@Injectable()
export class InviteAdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly adminRolesRepository: AdminRolesRepository,
    private readonly issueAdminInviteService: IssueAdminInviteService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async inviteAdminUser(
    actorAdminUserId: string,
    input: InviteAdminUserInput,
  ): Promise<AdminUserModel> {
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

    const existing = await this.adminUsersRepository.findByEmail(input.email);
    if (existing) {
      throw adminUserEmailTaken();
    }

    const role = await this.adminRolesRepository.findById(input.roleId);
    if (!role) {
      throw adminRoleNotFound(input.roleId);
    }

    const created = await this.adminUsersRepository.createInvited({
      email: input.email,
      displayName: input.displayName,
      roleId: input.roleId,
    });

    await this.issueAdminInviteService.issueForAdminUser(
      created.id,
      created.email,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId,
        action: 'ADMIN_USER_INVITED',
        targetType: 'AdminUser',
        targetKey: created.id,
        metadata: {
          email: created.email,
          roleId: input.roleId,
        },
      });
    });

    return toAdminUserModel(created);
  }
}
