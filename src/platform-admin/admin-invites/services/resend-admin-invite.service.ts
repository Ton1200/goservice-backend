import { Injectable } from '@nestjs/common';
import { AdminUserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  adminUserNotFound,
  adminUserNotInvited,
} from '../../admin-users/errors/admin-user.errors';
import { ResendAdminInvitePayload } from '../models/resend-admin-invite-payload.model';
import { IssueAdminInviteService } from './issue-admin-invite.service';

/**
 * Orchestrates `resendAdminInvite` — only makes sense for an `AdminUser`
 * currently `INVITED` (`ADMIN_USER_NOT_INVITED` otherwise: already `ACTIVE`
 * or already `REVOKED`). Reuses `IssueAdminInviteService` (the same
 * mechanism `InviteAdminUserService` uses for the FIRST invite). Audits
 * `ADMIN_USER_INVITE_RESENT` ONLY when `issued === true` — a no-op caused by
 * the resend cooldown is not itself an auditable action (nothing actually
 * happened).
 */
@Injectable()
export class ResendAdminInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly issueAdminInviteService: IssueAdminInviteService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async resendAdminInvite(
    actorAdminUserId: string,
    adminUserId: string,
  ): Promise<ResendAdminInvitePayload> {
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

    const existing = await this.adminUsersRepository.findById(adminUserId);
    if (!existing) {
      throw adminUserNotFound(adminUserId);
    }
    if (existing.status !== AdminUserStatus.INVITED) {
      throw adminUserNotInvited(adminUserId);
    }

    const { issued } = await this.issueAdminInviteService.issueForAdminUser(
      existing.id,
      existing.email,
      existing.displayName,
    );

    if (issued) {
      await this.prisma.$transaction(async (tx) => {
        await this.auditLogRepository.write(tx, {
          actorAdminUserId,
          action: 'ADMIN_USER_INVITE_RESENT',
          targetType: 'AdminUser',
          targetKey: adminUserId,
        });
      });
    }

    return { success: issued };
  }
}
