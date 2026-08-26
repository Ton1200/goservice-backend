import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { isLoginEligibleStatus } from '../../auth/services/login-eligibility.util';
import { EnsureEmailDeliveryAvailableService } from '../../email/services/ensure-email-delivery-available.service';
import { PasswordHasherPort } from '../../users/ports/password-hasher.port';
import { UsersRepository } from '../../users/users.repository';
import { RequestPasswordResetPayload } from '../models/request-password-reset-payload.model';
import { IssuePasswordResetCodeService } from './issue-password-reset-code.service';

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
    private readonly passwordHasher: PasswordHasherPort,
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
    private readonly issuePasswordResetCodeService: IssuePasswordResetCodeService,
  ) {}

  async requestPasswordReset(
    email: string,
  ): Promise<RequestPasswordResetPayload> {
    // Checked FIRST, BEFORE the `findByEmail` lookup below — critical for
    // this method's own anti-enumeration guarantee (see this class's own
    // doc comment). This is a GLOBAL, not-per-account check (see
    // `EnsureEmailDeliveryAvailableService`'s own doc comment), so running
    // it ahead of any per-account work does not leak whether `email`
    // belongs to a real account: every caller gets the identical
    // `EMAIL_DELIVERY_DISABLED`/`EMAIL_DELIVERY_MISCONFIGURED` error,
    // unknown email or not.
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

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

    // The actual "generate + persist + email" mechanism is shared with the
    // admin-triggered `forceUserAccountPasswordReset` — see
    // `IssuePasswordResetCodeService`'s own header comment. Whether it
    // actually issued a new code (vs. a no-op within the resend cooldown)
    // only affects THIS service's own logging outcome — the response and
    // timing profile are identical either way (anti-enumeration).
    const { issued } = await this.issuePasswordResetCodeService.issueForUser(
      user.id,
      user.email,
      user.firstName,
    );
    if (!issued) {
      await this.getDecoyHash();
      this.logAttempt('noop');
      return { requested: true };
    }

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
