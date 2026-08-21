import { Injectable } from '@nestjs/common';
import { IdentityVerificationRepository } from '../identity-verification.repository';
import { IdentityVerificationModel } from '../models/identity-verification.model';

/**
 * Orchestrates `Query.myIdentityVerificationStatus` — lets mobile poll for
 * the outcome of an in-flight verification while waiting for Didit's
 * webhook to land, without depending solely on the `callback` deep-link
 * (a mobile-side concern, out of this backend's scope). Returns the user's
 * MOST RECENT attempt only (`IdentityVerificationRepository.
 * findMostRecentByUserId`) — `null` if they have never started one.
 *
 * `verificationUrl` is always `null` here — see `IdentityVerificationModel`'s
 * own header comment for why.
 */
@Injectable()
export class GetMyIdentityVerificationStatusService {
  constructor(
    private readonly identityVerificationRepository: IdentityVerificationRepository,
  ) {}

  async getMyIdentityVerificationStatus(
    userId: string,
  ): Promise<IdentityVerificationModel | null> {
    const row =
      await this.identityVerificationRepository.findMostRecentByUserId(userId);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
      documentCheckPassed: row.documentCheckPassed,
      biometricCheckPassed: row.biometricCheckPassed,
      verificationUrl: null,
    };
  }
}
