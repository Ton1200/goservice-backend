import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { UserAccountStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { UsersRepository } from '../../users/users.repository';
import { DIDIT_PROVIDER_NAME } from '../constants/didit-settings.constants';
import { accountNotPendingApproval } from '../errors/account-not-pending-approval.error';
import { IdentityVerificationRepository } from '../identity-verification.repository';
import { IdentityVerificationModel } from '../models/identity-verification.model';
import { IdentityVerificationProviderRegistry } from './identity-verification-provider-registry.service';

/**
 * Orchestrates `Mutation.startIdentityVerification` — the ONLY place
 * `country` is ever resolved for this feature, and it is ALWAYS resolved
 * server-side from the caller's own `CustomerProfile`/`ProfessionalProfile`
 * (`ProfilesRepository.findCountryForUser`), NEVER from a GraphQL argument:
 * `startIdentityVerification` takes no input at all (see
 * `IdentityVerificationResolver`) — there is structurally no field for a
 * client to manipulate.
 *
 * Ordering, deliberate (see `IdentityVerificationRepository.create`'s own
 * comment): this service generates the `IdentityVerification` row's `id`
 * app-side, BEFORE calling Didit, so that id can be sent to Didit as
 * `vendor_data` — the provider's own opaque correlation identifier, used
 * later by `HandleIdentityVerificationWebhookService` to find this row
 * again. The row is only ever persisted ONCE, AFTER `createSession`
 * succeeds (with `providerReference` already known) — never a
 * create-then-update two-phase write, and never an orphaned row left behind
 * if the Didit call fails (nothing is persisted at all in that case; a
 * retry simply calls this service again and creates a fresh row — no
 * retry/resume-in-place policy exists yet, a documented open question in
 * the implementation plan).
 */
@Injectable()
export class StartIdentityVerificationService {
  private readonly logger = new Logger(StartIdentityVerificationService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly profilesRepository: ProfilesRepository,
    private readonly identityVerificationRepository: IdentityVerificationRepository,
    private readonly identityVerificationProviderRegistry: IdentityVerificationProviderRegistry,
  ) {}

  async startIdentityVerification(
    userId: string,
  ): Promise<IdentityVerificationModel> {
    const accountStatus =
      await this.usersRepository.findAccountStatusById(userId);
    if (accountStatus !== UserAccountStatus.PENDING_APPROVAL) {
      throw accountNotPendingApproval();
    }

    const country = await this.profilesRepository.findCountryForUser(userId);
    if (!country) {
      // Should never happen: reaching PENDING_APPROVAL already requires at
      // least one profile to exist (see
      // `UsersRepository.transitionToPendingApprovalIfEmailVerified`'s own
      // comment) — logged as a real internal-consistency problem, not
      // silently swallowed, same "should never happen" precedent as
      // `GetMyAccountService.getMyAccount`.
      this.logger.warn({
        event: 'identity_verification_country_unresolvable',
        userId,
      });
      throw new Error(
        'Could not resolve a country for this user — no CustomerProfile or ProfessionalProfile found.',
      );
    }

    const adapter =
      await this.identityVerificationProviderRegistry.resolve(country);

    const identityVerificationId = randomUUID();
    const session = await adapter.createSession({
      identityVerificationId,
      country,
    });

    const row = await this.identityVerificationRepository.create({
      id: identityVerificationId,
      userId,
      country,
      provider: DIDIT_PROVIDER_NAME,
      providerReference: session.providerReference,
    });

    this.logger.log({
      event: 'identity_verification_session_started',
      userId,
      country,
      providerReference: session.providerReference,
    });

    return {
      id: row.id,
      status: row.status,
      documentCheckPassed: row.documentCheckPassed,
      biometricCheckPassed: row.biometricCheckPassed,
      verificationUrl: session.verificationUrl,
    };
  }
}
