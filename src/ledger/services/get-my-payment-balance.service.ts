import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { LedgerRepository } from '../ledger.repository';

/**
 * Orchestrates `Query.myPaymentBalance` — always "mine", derived from
 * `@CurrentUser()`, no arguments. Reuses `professionalProfileRequired()`
 * from `quotes/errors/` (not duplicated under a new name), same missing
 * -profile semantics as `GetMyPendingCashCommissionDebtService`.
 *
 * The authenticated Professional's CURRENT payment balance
 * (`LedgerRepository.sumProfessionalBalance`'s own header comment explains
 * the "computed fresh on every read, available immediately" design, and why
 * it can be negative).
 */
@Injectable()
export class GetMyPaymentBalanceService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async getMyPaymentBalance(userId: string): Promise<number> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    return this.ledgerRepository.sumProfessionalBalance(professionalProfile.id);
  }
}
