import { Injectable } from '@nestjs/common';
import { LedgerEntry } from '@prisma/client';
import { LedgerRepository } from '../../ledger/ledger.repository';
import { ProfilesRepository } from '../../profiles/profiles.repository';

/**
 * Orchestrates `Query.myPaymentReceipts` — always "mine", derived from
 * `@CurrentUser()`, no arguments. Resolves BOTH of the caller's possible
 * profile types (a User may hold both a `CustomerProfile` and a
 * `ProfessionalProfile`) and returns every `LedgerEntry` where either one is
 * denormalized, via `LedgerRepository.findManyForCallerProfiles`.
 *
 * Deliberately does NOT throw when the caller has neither profile type —
 * unlike `professionalProfileRequired()`/`customerProfileRequired()`
 * elsewhere, an empty list is a perfectly valid, non-error answer here (a
 * brand-new account with no Engagement yet has no receipts, not a "profile
 * required" error).
 */
@Injectable()
export class ListMyPaymentReceiptsService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async listMyPaymentReceipts(userId: string): Promise<LedgerEntry[]> {
    const [customerProfile, professionalProfile] = await Promise.all([
      this.profilesRepository.findCustomerProfileByUserId(userId),
      this.profilesRepository.findProfessionalProfileByUserId(userId),
    ]);

    return this.ledgerRepository.findManyForCallerProfiles({
      customerProfileId: customerProfile?.id,
      professionalProfileId: professionalProfile?.id,
    });
  }
}
