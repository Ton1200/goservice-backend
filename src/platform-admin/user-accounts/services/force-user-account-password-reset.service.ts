import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { IssuePasswordResetCodeService } from '../../../password-reset/services/issue-password-reset-code.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { userAccountNotFound } from '../errors/user-account.errors';
import { ForceUserAccountPasswordResetPayload } from '../models/force-user-account-password-reset-payload.model';

/**
 * Orchestrates `forceUserAccountPasswordReset`. Reuses the EXACT SAME
 * underlying code-generation/persistence/email-sending mechanism
 * `requestPasswordReset` uses — `IssuePasswordResetCodeService`, called
 * directly (never the public `requestPasswordReset` resolver/mutation) —
 * see that service's own header comment.
 *
 * Differences from the consumer-facing `requestPasswordReset`, by design:
 *   - No anti-enumeration behavior: if `userId` doesn't resolve to a real
 *     `User`, this throws a clear, specific `USER_ACCOUNT_NOT_FOUND` error.
 *     The admin is authenticated and already knows this specific user
 *     exists (they selected them in the grid) — there is no enumeration
 *     surface to protect here.
 *   - STILL gated by `EnsureEmailDeliveryAvailableService` FIRST, before any
 *     other work — an admin clicking "force reset" while email delivery is
 *     down gets the same `EMAIL_DELIVERY_DISABLED`/
 *     `EMAIL_DELIVERY_MISCONFIGURED` errors every other email-sending
 *     mutation gets, rather than a silently-queued-to-fail job.
 *   - Writes its own distinct `AdminAuditLog` entry
 *     (`USER_ACCOUNT_PASSWORD_RESET_FORCED`) — audited unconditionally, even
 *     on the rare case where `IssuePasswordResetCodeService`'s own resend
 *     cooldown makes this call a no-op for actually sending a NEW email (a
 *     code was already very recently issued): the admin's INTENT to force a
 *     reset is still the auditable event. No metadata beyond the standard
 *     `targetType`/`targetKey` — never anything password-related, which
 *     this mutation never touches (it only ever triggers the existing
 *     reset-code-email flow; it can never accept/set a raw password value).
 *
 * The audit-log write runs in its OWN minimal `$transaction` (a single
 * statement) rather than sharing one with `IssuePasswordResetCodeService`'s
 * own writes: unlike `UpdateUserAccountService`, this action's real
 * side-effect (creating a `PasswordResetCode` row AND enqueueing a real
 * email) is not meaningfully atomic with a DB-only audit-log row anyway —
 * the email enqueue can't participate in a Postgres transaction. Simpler and
 * still satisfies `AuditLogRepository.write`'s "always via an open
 * transaction" invariant.
 */
@Injectable()
export class ForceUserAccountPasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
    private readonly issuePasswordResetCodeService: IssuePasswordResetCodeService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async forceUserAccountPasswordReset(
    adminUserId: string,
    userId: string,
  ): Promise<ForceUserAccountPasswordResetPayload> {
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

    const user = await this.usersRepository.findByIdForAdmin(userId);
    if (!user) {
      throw userAccountNotFound(userId);
    }

    await this.issuePasswordResetCodeService.issueForUser(user.id, user.email);

    await this.prisma.$transaction(async (tx) => {
      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'USER_ACCOUNT_PASSWORD_RESET_FORCED',
        targetType: 'User',
        targetKey: userId,
      });
    });

    return { success: true };
  }
}
