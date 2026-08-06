import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { isLoginEligibleStatus } from '../../auth/services/login-eligibility.util';
import { SessionPort } from '../../auth/ports/session.port';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { PasswordResetRepository } from '../password-reset.repository';
import { ResetPasswordInput } from '../models/reset-password-input.model';
import { ResetPasswordPayload } from '../models/reset-password-payload.model';
import { hashPasswordResetCode } from './password-reset-code.util';

const GENERIC_FAILURE_CODE = 'RESET_CODE_INVALID_OR_EXPIRED';
const GENERIC_FAILURE_MESSAGE =
  'The password reset code is invalid or has expired.';

/**
 * All failure modes here (user not found, social-only account, ineligible
 * accountStatus, no active code, too many attempts, expired, wrong code)
 * deliberately collapse to ONE generic result —
 * `{ success: false, errors: [{ code: 'RESET_CODE_INVALID_OR_EXPIRED' }] }`
 * — mirroring `verify-email-code.service.ts`'s anti-enumeration shape. Do
 * not add finer-grained codes here.
 *
 * Deliberate exception to the paragraph above (GOS-9 follow-up): once the
 * one-time code itself has already been validated as correct, the caller
 * has already proven possession of the code sent to the account's email —
 * i.e. they've already demonstrated real control of the account. At that
 * point there is no enumeration risk left to protect (unlike the earlier
 * checks, which must stay generic because they run before that proof).
 * So the one additional check that runs after the code matches — "is
 * `newPassword` the same as the current password?" — returns its own
 * specific `NEW_PASSWORD_SAME_AS_CURRENT` error instead of the generic
 * one. Do not fold this back into the generic bucket, and do not use this
 * as precedent to add other finer-grained codes to the checks above it.
 *
 * On success: hashes the new password (same `PasswordHasherPort` as
 * registration/login), persists it, consumes the matched code, invalidates
 * any other remaining active code for the user (defense in depth), and —
 * per the resolved GOS-9 session decision (see
 * `goservice-backend/docs/gos9-plan-tecnico.md` §11) — revokes every
 * `ACTIVE` session the user holds. All of this always happens together in
 * the happy path; there is no Prisma transaction wrapping these writes
 * (deemed unnecessary ceremony for this story), but the order below
 * guarantees the password is durably changed before sessions are revoked.
 */
@Injectable()
export class ResetPasswordService {
  private readonly logger = new Logger(ResetPasswordService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly sessionPort: SessionPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async resetPassword(
    input: ResetPasswordInput,
  ): Promise<ResetPasswordPayload> {
    const user = await this.usersRepository.findByEmail(input.email);

    const isEligible =
      user !== null &&
      user.authProvider === AuthProvider.PASSWORD &&
      user.passwordHash !== null &&
      isLoginEligibleStatus(user.accountStatus);

    if (!isEligible) {
      return this.genericFailure('user_not_eligible');
    }

    const activeCode =
      await this.passwordResetRepository.findActivePasswordResetCode(user.id);
    if (!activeCode) {
      return this.genericFailure('no_active_code');
    }

    const { maxAttempts } = this.configService.get('passwordReset', {
      infer: true,
    });
    if (activeCode.attemptsCount >= maxAttempts) {
      return this.genericFailure('max_attempts_exceeded');
    }

    if (activeCode.expiresAt.getTime() < Date.now()) {
      return this.genericFailure('code_expired');
    }

    if (hashPasswordResetCode(input.code) !== activeCode.codeHash) {
      await this.passwordResetRepository.incrementAttempts(activeCode.id);
      return this.genericFailure('code_mismatch');
    }

    // The code is now proven valid — the caller has demonstrated real
    // control of the account, so this check is allowed to be specific
    // (see class comment). Deliberately does NOT increment attemptsCount
    // or consume/invalidate the code: the code is still valid and the
    // user gets to retry with a different password using it.
    //
    // Non-null assertion: `isEligible` above already confirmed
    // `user.passwordHash !== null` — TS's aliased-condition narrowing
    // applies to `user` itself (hence plain `user.id`/`user.accountStatus`
    // access below), but doesn't propagate into this nested property.
    const isSameAsCurrentPassword = await this.passwordHasher.verify(
      user.passwordHash!,
      input.newPassword,
    );
    if (isSameAsCurrentPassword) {
      this.logger.log({
        event: 'password_reset_attempt',
        outcome: 'failure',
        failureReason: 'new_password_same_as_current',
      });
      return {
        success: false,
        errors: [
          {
            code: 'NEW_PASSWORD_SAME_AS_CURRENT',
            message:
              'The new password must be different from your current password.',
          },
        ],
      };
    }

    // Never log the plaintext newPassword, before or after hashing.
    const newPasswordHash = await this.passwordHasher.hash(input.newPassword);
    await this.usersRepository.updatePasswordHash(user.id, newPasswordHash);
    await this.passwordResetRepository.consumeCode(activeCode.id);
    await this.passwordResetRepository.invalidateOtherActiveCodes(
      user.id,
      activeCode.id,
    );
    await this.sessionPort.revokeAllSessionsForUser(user.id);

    this.logger.log({ event: 'password_reset_attempt', outcome: 'success' });
    return { success: true, errors: [] };
  }

  private genericFailure(failureReason: string): ResetPasswordPayload {
    this.logger.log({
      event: 'password_reset_attempt',
      outcome: 'failure',
      failureReason,
    });
    return {
      success: false,
      errors: [
        { code: GENERIC_FAILURE_CODE, message: GENERIC_FAILURE_MESSAGE },
      ],
    };
  }
}
