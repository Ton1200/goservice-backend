import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { LedgerRepository } from '../../ledger/ledger.repository';

/**
 * Orchestrates `Query.myPendingCashCommissionDebt` — always "mine", derived
 * from `@CurrentUser()`, no arguments. Reuses `professionalProfileRequired()`
 * from `quotes/errors/` (not duplicated under a new name), same missing
 * -profile semantics as `ListMyEngagementsAsProfessionalService`.
 *
 * Scope of THIS story: sums EVERY `CASH_COMMISSION_DEBT` entry ever written
 * for the caller's `ProfessionalProfile` — there is no "regularize" flow or
 * automatic discount against the Professional's next digital charge yet
 * (both depend on GOS-79, not built). This query is the read-only surface a
 * future regularization UI would build on; it does not itself implement one.
 */
@Injectable()
export class GetMyPendingCashCommissionDebtService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async getMyPendingCashCommissionDebt(userId: string): Promise<number> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    return this.ledgerRepository.sumCashCommissionDebtForProfessional(
      professionalProfile.id,
    );
  }
}
