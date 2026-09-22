import { Injectable } from '@nestjs/common';
import { LedgerRepository } from '../../../ledger/ledger.repository';
import { UsersRepository } from '../../../users/users.repository';
import { userAccountNotFound } from '../errors/user-account.errors';
import { toUserAccountDetailModel } from '../models/to-user-account-detail-model.util';
import { UserAccountDetailModel } from '../models/user-account-detail.model';

/**
 * Orchestrates `userAccountDetail` (GOS-3x follow-up — admin panel's Users
 * grid, "View" row action). Gated by the SAME `Permission.USER_ACCOUNTS_READ`
 * as `userAccounts` — no new permission for this read-only detail view.
 * Fetches lazily, on demand (never pre-loaded alongside the grid's own
 * lightweight `userAccounts` page) — see `UsersRepository`'s
 * `findByIdForAdminWithProfiles` for why this uses a deliberately separate,
 * richer select than the grid's own `findByIdForAdmin`/`findManyForAdmin`.
 *
 * **2026-09-19**: also computes `professionalPaymentBalance` (same figure
 * `myPaymentBalance`/`AdminLedgerProfessional.balance` compute — see
 * `LedgerRepository.sumProfessionalBalance`'s own comment) when the account
 * has a `ProfessionalProfile`, so an admin sees it right on this account's
 * own detail view, not only on a Receipts row for one of their jobs.
 */
@Injectable()
export class GetUserAccountDetailService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async getUserAccountDetail(id: string): Promise<UserAccountDetailModel> {
    const row = await this.usersRepository.findByIdForAdminWithProfiles(id);
    if (!row) {
      throw userAccountNotFound(id);
    }
    const professionalPaymentBalance = row.professionalProfile
      ? await this.ledgerRepository.sumProfessionalBalance(
          row.professionalProfile.id,
        )
      : null;
    return toUserAccountDetailModel(row, professionalPaymentBalance);
  }
}
