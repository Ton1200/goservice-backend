import { Injectable } from '@nestjs/common';
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
 */
@Injectable()
export class GetUserAccountDetailService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getUserAccountDetail(id: string): Promise<UserAccountDetailModel> {
    const row = await this.usersRepository.findByIdForAdminWithProfiles(id);
    if (!row) {
      throw userAccountNotFound(id);
    }
    return toUserAccountDetailModel(row);
  }
}
