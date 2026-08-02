import { Injectable, Logger } from '@nestjs/common';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { SessionPort } from '../ports/session.port';
import { LoginInput } from '../models/login-input.model';
import { LoginPayload } from '../models/login-payload.model';
import { UsersRepository } from '../../users/users.repository';
import { authenticationFailed } from '../errors/authentication-failed.error';
import { isLoginEligibleStatus } from './login-eligibility.util';

/**
 * A fixed, non-secret plaintext, hashed exactly once (memoized) via the
 * real `PasswordHasherPort.hash()` and used as the verification target
 * whenever the looked-up user doesn't exist or has no `passwordHash`
 * (social-only accounts). This makes `PasswordHasherPort.verify()` run on
 * EVERY login attempt, real or not — mitigating a timing side-channel that
 * would otherwise let an attacker distinguish "no such user"/"social-only
 * account" from "wrong password" by response latency, without hardcoding a
 * stale hash computed at a different time/cost setting than real ones.
 */
const DECOY_PLAINTEXT = 'goservice-login-decoy-plaintext-not-a-real-secret';

/**
 * Orchestrates `login` (GOS-7): email + password authentication issuing an
 * opaque session token on success. Every failure — unknown email, wrong
 * password, social-only account, ineligible account status — collapses to
 * the single shared `authenticationFailed()` result, never distinguishing
 * which case occurred (anti-enumeration, matches `socialLogin`'s
 * semantics exactly).
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);
  private decoyHash: Promise<string> | undefined;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly sessionPort: SessionPort,
  ) {}

  async login(input: LoginInput): Promise<LoginPayload> {
    const user = await this.usersRepository.findByEmail(input.email);

    // Always runs verify() — against the real hash when available, or the
    // memoized decoy hash otherwise — so response latency doesn't leak
    // account existence/shape.
    const hashToVerifyAgainst =
      user?.passwordHash ?? (await this.getDecoyHash());
    const passwordMatches = await this.passwordHasher.verify(
      hashToVerifyAgainst,
      input.password,
    );

    if (
      !user ||
      !user.passwordHash ||
      !passwordMatches ||
      !isLoginEligibleStatus(user.accountStatus)
    ) {
      this.logAttempt('failure');
      throw authenticationFailed();
    }

    const session = await this.sessionPort.createSession({ userId: user.id });

    this.logAttempt('success');
    return {
      userId: user.id,
      sessionToken: session.sessionToken,
      sessionExpiresAt: session.expiresAt,
      errors: [],
    };
  }

  private getDecoyHash(): Promise<string> {
    this.decoyHash ??= this.passwordHasher.hash(DECOY_PLAINTEXT);
    return this.decoyHash;
  }

  private logAttempt(outcome: 'success' | 'failure'): void {
    this.logger.log({ event: 'login_attempt', outcome });
  }
}
