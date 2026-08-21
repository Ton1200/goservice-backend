import { Injectable, Logger } from '@nestjs/common';
import { AdminUserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PasswordHasherPort } from '../../../users/ports/password-hasher.port';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { AdminInvitesRepository } from '../admin-invites.repository';
import { adminInviteTokenInvalidOrExpired } from '../errors/admin-invite.errors';
import { AcceptAdminInviteInput } from '../models/accept-admin-invite.input';
import { AcceptAdminInvitePayload } from '../models/accept-admin-invite-payload.model';
import { hashAdminInviteToken } from './admin-invite-token.util';

const GENERIC_FAILURE_CODE = 'ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED';

/**
 * Orchestrates `acceptAdminInvite` — the ONLY mutation in this entire
 * feature with NO guard at all (reachable by anyone with the link, not just
 * an authenticated admin). ALL failure cases (token doesn't exist / expired
 * / already consumed / already invalidated) collapse into the ONE generic
 * `ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED` result — mirrors
 * `ResetPasswordService`'s `RESET_CODE_INVALID_OR_EXPIRED` anti-enumeration
 * precedent EXACTLY (see that service's own header comment). Do not add a
 * finer-grained code here for any of these cases.
 *
 * On success: hashes the new password (same `PasswordHasherPort` as
 * registration/login/reset), and in ONE `$transaction` sets
 * `AdminUser.passwordHash` + `status: ACTIVE` AND marks the `AdminInvite`
 * consumed — both commit atomically or not at all. Returns
 * `{ success: true, errors: [] }` — NO session/token issued (mirrors
 * `RegisterPayload`'s own shape); the new admin does a normal, separate
 * `adminLogin` afterward.
 */
@Injectable()
export class AcceptAdminInviteService {
  private readonly logger = new Logger(AcceptAdminInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminInvitesRepository: AdminInvitesRepository,
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly passwordHasher: PasswordHasherPort,
  ) {}

  async acceptAdminInvite(
    input: AcceptAdminInviteInput,
  ): Promise<AcceptAdminInvitePayload> {
    const tokenHash = hashAdminInviteToken(input.token);
    const invite = await this.adminInvitesRepository.findByTokenHash(tokenHash);

    const isValid =
      invite !== null &&
      invite.consumedAt === null &&
      invite.invalidatedAt === null &&
      invite.expiresAt.getTime() > Date.now();

    if (!isValid) {
      this.logger.log({ event: 'accept_admin_invite', outcome: 'failure' });
      return this.genericFailure();
    }

    // Never log the plaintext newPassword, before or after hashing.
    const passwordHash = await this.passwordHasher.hash(input.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.adminUsersRepository.updateForAdmin(tx, invite.adminUserId, {
        passwordHash,
        status: AdminUserStatus.ACTIVE,
      });
      await this.adminInvitesRepository.consume(tx, invite.id);
    });

    this.logger.log({ event: 'accept_admin_invite', outcome: 'success' });
    return { success: true, errors: [] };
  }

  private genericFailure(): AcceptAdminInvitePayload {
    return {
      success: false,
      errors: [
        {
          code: GENERIC_FAILURE_CODE,
          message: adminInviteTokenInvalidOrExpired().message,
        },
      ],
    };
  }
}
