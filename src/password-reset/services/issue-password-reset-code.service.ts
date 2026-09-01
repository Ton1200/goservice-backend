import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PasswordResetRepository } from '../password-reset.repository';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';
import { generatePasswordResetCode } from './password-reset-code.util';

/**
 * Extracted, shared "generate a fresh code, persist it, email it" mechanism
 * — the ONE place this actually happens (GOS-3x follow-up, 2026-08-10,
 * extracted from what used to be inline in `RequestPasswordResetService`).
 * Reused by BOTH:
 *   - `RequestPasswordResetService` (GOS-9, the consumer-facing
 *     `requestPasswordReset` mutation) — wraps this in its own
 *     eligibility/anti-enumeration/decoy-hash logic.
 *   - `ForceUserAccountPasswordResetService`
 *     (`src/platform-admin/user-accounts/`, the admin-triggered
 *     `forceUserAccountPasswordReset` mutation) — wraps this in its own
 *     `EnsureEmailDeliveryAvailableService` gate + distinct `AdminAuditLog`
 *     entry, and deliberately skips the anti-enumeration/decoy-hash
 *     behavior (the admin already knows the user exists).
 * Neither caller duplicates the code-generation/persistence/email-sending
 * logic itself — see both services' own header comments.
 *
 * Registered TWICE in the DI graph on purpose (once inside
 * `PasswordResetModule`, once directly on `PlatformAdminModule`) — the same
 * "reuse the concrete provider class directly, never import the
 * resolver-bearing module" precedent already used for
 * `Argon2PasswordHasherAdapter` (see `PlatformAdminModule`'s own header
 * comment): `PasswordResetModule` has its own `PasswordResetResolver`, so
 * importing it wholesale into `PlatformAdminModule` would leak
 * `requestPasswordReset`/`resetPassword` into the ADMIN schema. This class's
 * dependencies (`PasswordResetRepository`, `PasswordResetEmailSenderPort`,
 * `ConfigService`) are all safe to construct a second time — each is
 * stateless beyond the shared, global `PrismaService`/Redis-backed queue
 * connection underneath.
 *
 * DELIBERATE BEHAVIORAL DECISION, flagged for reviewer sign-off: this
 * respects the SAME resend cooldown (`passwordReset.resendCooldownSeconds`)
 * for BOTH callers, including the admin-triggered path — an accidental admin
 * double-click (or a compromised admin session) should not be able to
 * email-bomb a user any more than the user could email-bomb themselves by
 * repeatedly calling `requestPasswordReset`. If a future admin-UX need
 * requires bypassing the cooldown for support-desk scenarios, that would be
 * a deliberate, separate decision — not the default assumed here.
 */
@Injectable()
export class IssuePasswordResetCodeService {
  constructor(
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly passwordResetEmailSender: PasswordResetEmailSenderPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Returns `{ issued: false }` (no-op — no new code created, no email
   * sent) when an active code already exists and its resend cooldown has
   * not yet elapsed; `{ issued: true }` otherwise, after invalidating any
   * previous active code, creating the new one, and enqueueing the email.
   */
  async issueForUser(
    userId: string,
    email: string,
    firstName: string | null,
  ): Promise<{ issued: boolean }> {
    const { codeTtlMinutes, resendCooldownSeconds } = this.configService.get(
      'passwordReset',
      { infer: true },
    );

    const activeCode =
      await this.passwordResetRepository.findActivePasswordResetCode(userId);

    if (activeCode) {
      const cooldownEndsAt =
        activeCode.createdAt.getTime() + resendCooldownSeconds * 1000;
      if (cooldownEndsAt > Date.now()) {
        return { issued: false };
      }
      await this.passwordResetRepository.invalidateCode(activeCode.id);
    }

    const { code, codeHash } = generatePasswordResetCode();
    const expiresAt = new Date(Date.now() + codeTtlMinutes * 60_000);
    await this.passwordResetRepository.createPasswordResetCode({
      userId,
      codeHash,
      expiresAt,
    });
    await this.passwordResetEmailSender.sendPasswordResetCode(
      email,
      code,
      firstName,
    );

    return { issued: true };
  }
}
