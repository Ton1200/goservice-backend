import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserAccountStatus } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { ResendVerificationCodePayload } from '../models/resend-verification-code-payload.model';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';
import { UsersRepository } from '../users.repository';
import { generateVerificationCode } from './verification-code.util';

/**
 * The return shape (`{ resent: true, nextResendAvailableAt }`) must never
 * reveal whether the email exists — see the "user not found" and "already
 * verified" branches below, which both compute a synthetic
 * `nextResendAvailableAt` without any DB write, so a timing/response-shape
 * side channel doesn't leak account existence.
 */
@Injectable()
export class ResendVerificationCodeService {
  private readonly logger = new Logger(ResendVerificationCodeService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly verificationCodeSender: VerificationCodeSenderPort,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async resendVerificationCode(
    email: string,
  ): Promise<ResendVerificationCodePayload> {
    const { codeTtlMinutes, resendCooldownSeconds } = this.configService.get(
      'emailVerification',
      { infer: true },
    );

    const user = await this.usersRepository.findByEmail(email);

    if (
      !user ||
      user.accountStatus !== UserAccountStatus.PENDING_EMAIL_VERIFICATION
    ) {
      // Nothing to resend (no such user, or already verified) — synthetic,
      // no DB write beyond the lookup already performed above.
      this.logger.log({
        event: 'resend_verification_code_attempt',
        outcome: 'noop_synthetic_response',
      });
      return {
        resent: true,
        nextResendAvailableAt: this.secondsFromNow(resendCooldownSeconds),
      };
    }

    const activeCode =
      await this.usersRepository.findActiveEmailVerificationCode(user.id);

    if (activeCode) {
      const cooldownEndsAt =
        activeCode.createdAt.getTime() + resendCooldownSeconds * 1000;
      if (cooldownEndsAt > Date.now()) {
        // Still within cooldown — idempotent, do not generate a new code
        // or extend the cooldown.
        this.logger.log({
          event: 'resend_verification_code_attempt',
          outcome: 'noop_within_cooldown',
        });
        return {
          resent: true,
          nextResendAvailableAt: new Date(cooldownEndsAt),
        };
      }
      await this.usersRepository.invalidateCode(activeCode.id);
    }

    const { code, codeHash } = generateVerificationCode();
    const expiresAt = new Date(Date.now() + codeTtlMinutes * 60_000);
    await this.usersRepository.createEmailVerificationCode({
      userId: user.id,
      codeHash,
      expiresAt,
    });
    await this.verificationCodeSender.sendVerificationCode(user.email, code);

    this.logger.log({
      event: 'resend_verification_code_attempt',
      outcome: 'new_code_issued',
    });
    return {
      resent: true,
      nextResendAvailableAt: this.secondsFromNow(resendCooldownSeconds),
    };
  }

  private secondsFromNow(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }
}
