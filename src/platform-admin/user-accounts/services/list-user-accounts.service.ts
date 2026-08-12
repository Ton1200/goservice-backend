import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../../../users/users.repository';
import { toUserAccountModel } from '../models/to-user-account-model.util';
import { UserAccountsPageModel } from '../models/user-accounts-page.model';

const DEFAULT_LIMIT = 50;

/**
 * DELIBERATE, DOCUMENTED phase-1 scope boundary: real pagination
 * (`limit`/`offset`, clamped to a max page size), but NO server-side
 * filter/sort arguments yet. The admin panel's Tabulator grid fetches one
 * page (up to `MAX_LIMIT` rows) and does its own client-side
 * filtering/sorting/column operations on that fetched page — this is not a
 * long-term design decision, just what this round actually needed and
 * built; a genuinely large `User` table would need real server-side
 * filtering before this scales further. Flagged in the final report, not a
 * silent limitation.
 */
const MAX_LIMIT = 200;

@Injectable()
export class ListUserAccountsService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async listUserAccounts(
    limitInput?: number,
    offsetInput?: number,
  ): Promise<UserAccountsPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const [rows, totalCount] = await Promise.all([
      this.usersRepository.findManyForAdmin({ limit, offset }),
      this.usersRepository.countAllForAdmin(),
    ]);

    const page = new UserAccountsPageModel();
    page.items = rows.map(toUserAccountModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
