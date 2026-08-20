import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { AdminInvitesRepository } from '../admin-invites.repository';
import { AdminInviteEmailSenderPort } from '../ports/admin-invite-email-sender.port';
import {
  generateAdminInviteToken,
  hashAdminInviteToken,
} from './admin-invite-token.util';

/**
 * Extracted, shared "generate a fresh invite token, persist it, email it"
 * mechanism — mirrors `IssuePasswordResetCodeService` exactly, including its
 * own resend-cooldown behavior. Reused by BOTH `InviteAdminUserService`
 * (first invite) and `ResendAdminInviteService` (resend). Does NOT call
 * `EnsureEmailDeliveryAvailableService` itself — that's the caller's job,
 * same split `IssuePasswordResetCodeService` already establishes.
 */
@Injectable()
export class IssueAdminInviteService {
  constructor(
    private readonly adminInvitesRepository: AdminInvitesRepository,
    private readonly adminInviteEmailSender: AdminInviteEmailSenderPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Returns `{ issued: false }` (no-op — no new invite created, no email
   * sent) when an active invite already exists and its resend cooldown has
   * not yet elapsed; `{ issued: true }` otherwise, after invalidating any
   * previous active invite, generating a fresh opaque token, persisting its
   * hash, and enqueueing the email.
   */
  async issueForAdminUser(
    adminUserId: string,
    email: string,
  ): Promise<{ issued: boolean }> {
    const { ttlHours, resendCooldownSeconds } = this.configService.get(
      'adminInvite',
      { infer: true },
    );

    const activeInvite =
      await this.adminInvitesRepository.findActiveByAdminUserId(adminUserId);

    if (activeInvite) {
      const cooldownEndsAt =
        activeInvite.createdAt.getTime() + resendCooldownSeconds * 1000;
      if (cooldownEndsAt > Date.now()) {
        return { issued: false };
      }
      await this.adminInvitesRepository.invalidate(activeInvite.id);
    }

    const rawToken = generateAdminInviteToken();
    const tokenHash = hashAdminInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
    await this.adminInvitesRepository.create({
      adminUserId,
      tokenHash,
      expiresAt,
    });
    await this.adminInviteEmailSender.sendAdminInvite(email, rawToken);

    return { issued: true };
  }
}
