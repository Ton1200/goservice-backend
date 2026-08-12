import { Injectable, Logger } from '@nestjs/common';
import { AdminUserStatus } from '@prisma/client';
import { PasswordHasherPort } from '../../../users/ports/password-hasher.port';
import { AdminSessionPort } from '../ports/admin-session.port';
import { AdminLoginInput } from '../models/admin-login-input.model';
import { AdminLoginPayload } from '../models/admin-login-payload.model';
import { AdminUsersRepository } from '../admin-users.repository';
import { adminAuthenticationFailed } from '../errors/admin-authentication-failed.error';

/**
 * Same anti-enumeration timing-side-channel mitigation as
 * `src/auth/services/login.service.ts`'s own `DECOY_PLAINTEXT` — a fixed,
 * non-secret plaintext hashed exactly once (memoized) so
 * `PasswordHasherPort.verify()` runs on EVERY `adminLogin` attempt, real or
 * not.
 */
const DECOY_PLAINTEXT =
  'goservice-admin-login-decoy-plaintext-not-a-real-secret';

/**
 * Orchestrates `adminLogin` — the deviation from the ticket's literal
 * contract required so a bootstrapped admin can obtain a session at all
 * (see the platform-admin plan's "Deviations" section). Reuses
 * `PasswordHasherPort`/`Argon2PasswordHasherAdapter` from `UsersModule`
 * rather than duplicating argon2 wiring — the "zero shared code" isolation
 * rule is specifically about the session/guard mechanism, not generic
 * hashing infrastructure.
 *
 * Every failure — unknown email, wrong password, no password set yet
 * (`INVITED`, Slice-3-only today), `REVOKED` — collapses to the single
 * shared `adminAuthenticationFailed()` result, never distinguishing which
 * case occurred.
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);
  private decoyHash: Promise<string> | undefined;

  constructor(
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly adminSessionPort: AdminSessionPort,
  ) {}

  async adminLogin(input: AdminLoginInput): Promise<AdminLoginPayload> {
    const adminUser = await this.adminUsersRepository.findByEmail(input.email);

    const hashToVerifyAgainst =
      adminUser?.passwordHash ?? (await this.getDecoyHash());
    const passwordMatches = await this.passwordHasher.verify(
      hashToVerifyAgainst,
      input.password,
    );

    if (
      !adminUser ||
      !adminUser.passwordHash ||
      !passwordMatches ||
      adminUser.status !== AdminUserStatus.ACTIVE
    ) {
      this.logAttempt('failure');
      throw adminAuthenticationFailed();
    }

    const session = await this.adminSessionPort.createSession({
      adminUserId: adminUser.id,
    });

    this.logAttempt('success');
    return {
      adminUserId: adminUser.id,
      sessionToken: session.sessionToken,
      sessionExpiresAt: session.expiresAt,
      email: adminUser.email,
      displayName: adminUser.displayName,
      errors: [],
    };
  }

  private getDecoyHash(): Promise<string> {
    this.decoyHash ??= this.passwordHasher.hash(DECOY_PLAINTEXT);
    return this.decoyHash;
  }

  private logAttempt(outcome: 'success' | 'failure'): void {
    this.logger.log({ event: 'admin_login_attempt', outcome });
  }
}
