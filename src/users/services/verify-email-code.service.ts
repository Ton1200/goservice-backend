import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { VerifyEmailCodeInput } from '../models/verify-email-code-input.model';
import { VerifyEmailCodePayload } from '../models/verify-email-code-payload.model';
import { UsersRepository } from '../users.repository';
import { hashVerificationCode } from './verification-code.util';

const GENERIC_FAILURE_CODE = 'CODE_INVALID_OR_EXPIRED';
const GENERIC_FAILURE_MESSAGE =
  'The verification code is invalid or has expired.';

/**
 * All failure modes here (user not found, no active code, too many
 * attempts, expired, wrong code) deliberately collapse to ONE generic
 * result — `{ success: false, errors: [{ code: 'CODE_INVALID_OR_EXPIRED' }] }`
 * — never distinguishing "no such user" from "wrong code", per GOS-22's own
 * spec (anti-enumeration). Do not add finer-grained codes here.
 */
@Injectable()
export class VerifyEmailCodeService {
  private readonly logger = new Logger(VerifyEmailCodeService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async verifyEmailCode(
    input: VerifyEmailCodeInput,
  ): Promise<VerifyEmailCodePayload> {
    const user = await this.usersRepository.findByEmail(input.email);
    if (!user) {
      return this.genericFailure('user_not_found');
    }

    const activeCode =
      await this.usersRepository.findActiveEmailVerificationCode(user.id);
    if (!activeCode) {
      return this.genericFailure('no_active_code');
    }

    const { maxAttempts } = this.configService.get('emailVerification', {
      infer: true,
    });
    if (activeCode.attemptsCount >= maxAttempts) {
      return this.genericFailure('max_attempts_exceeded');
    }

    if (activeCode.expiresAt.getTime() < Date.now()) {
      return this.genericFailure('code_expired');
    }

    if (hashVerificationCode(input.code) !== activeCode.codeHash) {
      await this.usersRepository.incrementAttempts(activeCode.id);
      return this.genericFailure('code_mismatch');
    }

    await this.usersRepository.consumeCode(activeCode.id);
    await this.usersRepository.markEmailVerified(user.id);

    this.logger.log({ event: 'verify_email_code_attempt', outcome: 'success' });
    return { success: true, errors: [] };
  }

  private genericFailure(failureReason: string): VerifyEmailCodePayload {
    this.logger.log({
      event: 'verify_email_code_attempt',
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
