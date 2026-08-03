import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { isLoginEligibleStatus } from '../../auth/services/login-eligibility.util';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';
import { PasswordResetRepository } from '../password-reset.repository';
import { RequestPasswordResetPayload } from '../models/request-password-reset-payload.model';
import { generatePasswordResetCode } from './password-reset-code.util';

/**
 * A fixed, non-secret plaintext, hashed exactly once (memoized) via the
 * real `PasswordHasherPort.hash()` — mirrors `login.service.ts`'s
 * `DECOY_PLAINTEXT` exactly. `requestPasswordReset` never verifies a
 * password, but it still performs this equivalent, expensive async work on
 * every no-op branch (unknown email, social-only account, ineligible
 * status, within cooldown) so response latency can't be used to
 * distinguish any of those cases from the real "new code issued" path.
 */
const DECOY_PLAINTEXT =
  'goservice-password-reset-decoy-plaintext-not-a-real-secret';

/**
 * Orchestrates `requestPasswordReset` (GOS-9). Every branch that does NOT
 * issue a new code — unknown email, social-only account (`authProvider !==
 * PASSWORD`), an account whose `accountStatus` is not login-eligible, or an
 * active code still within its resend cooldown — resolves to the exact
 * same `{ requested: true }` result, with no field or timing side-channel
 * that could reveal which case occurred. See
 * `goservice-backend/docs/gos9-plan-tecnico.md` §6/§9/§12 for the
 * resolved anti-enumeration/social-account/account-status decisions.
 */
@Injectable()
export class RequestPasswordResetService {
  private readonly logger = new Logger(RequestPasswordResetService.name);
  private decoyHash: Promise<string> | undefined;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly passwordResetEmailSender: PasswordResetEmailSenderPort,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async requestPasswordReset(
    email: string,
  ): Promise<RequestPasswordResetPayload> {
    const { codeTtlMinutes, resendCooldownSeconds } = this.configService.get(
      'passwordReset',
      { infer: true },
    );

    const user = await this.usersRepository.findByEmail(email);

    const isEligible =
      user !== null &&
      user.authProvider === AuthProvider.PASSWORD &&
      user.passwordHash !== null &&
      isLoginEligibleStatus(user.accountStatus);

    if (!isEligible) {
      // No such user, a social-only account, or an ineligible accountStatus
      // — all collapse to the same synthetic, no-DB-write outcome.
      await this.getDecoyHash();
      this.logAttempt('noop');
      return { requested: true };
    }

    const activeCode =
      await this.passwordResetRepository.findActivePasswordResetCode(user.id);

    if (activeCode) {
      const cooldownEndsAt =
        activeCode.createdAt.getTime() + resendCooldownSeconds * 1000;
      if (cooldownEndsAt > Date.now()) {
        // Still within cooldown — idempotent, do not generate a new code
        // or send another email.
        await this.getDecoyHash();
        this.logAttempt('noop');
        return { requested: true };
      }
      await this.passwordResetRepository.invalidateCode(activeCode.id);
    }

    const { code, codeHash } = generatePasswordResetCode();
    const expiresAt = new Date(Date.now() + codeTtlMinutes * 60_000);
    await this.passwordResetRepository.createPasswordResetCode({
      userId: user.id,
      codeHash,
      expiresAt,
    });
    await this.passwordResetEmailSender.sendPasswordResetCode(user.email, code);

    this.logAttempt('success');
    return { requested: true };
  }

  private getDecoyHash(): Promise<string> {
    this.decoyHash ??= this.passwordHasher.hash(DECOY_PLAINTEXT);
    return this.decoyHash;
  }

  /**
   * No `failureReason` here, unlike `resetPassword`'s `genericFailure` —
   * per the GOS-9 plan §16, this is the most enumeration-sensitive step
   * (public, unauthenticated), so even a server-side-only log field is
   * avoided, matching `login.service.ts`'s stricter logging criterion
   * rather than `verify-email-code.service.ts`'s.
   */
  private logAttempt(outcome: 'success' | 'noop'): void {
    this.logger.log({ event: 'password_reset_request_attempt', outcome });
  }
}
