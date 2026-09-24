import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { CURRENCY_BY_COUNTRY } from '../constants/country-currency.constants';
import { LedgerRepository } from '../ledger.repository';
import { WalletBalanceModel } from '../models/wallet-balance.model';

/**
 * GOS-159 — `Query.myWalletBalances`, always "mine" (derived from
 * `@CurrentUser()`). One row per currency the Professional holds ledger rows
 * in. With no rows yet, returns a single zero row in the currency of the
 * Professional's own country, so a client always has a currency to render.
 */
@Injectable()
export class GetMyWalletBalancesService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async getMyWalletBalances(userId: string): Promise<WalletBalanceModel[]> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    const balances =
      await this.ledgerRepository.sumProfessionalBalancesByCurrency(
        professionalProfile.id,
      );
    if (balances.length > 0) {
      return balances;
    }
    return [
      {
        currency: CURRENCY_BY_COUNTRY[professionalProfile.country],
        balance: 0,
        pendingCashCommissionDebt: 0,
      },
    ];
  }
}
