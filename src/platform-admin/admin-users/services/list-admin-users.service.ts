import { Injectable } from '@nestjs/common';
import { AdminUsersRepository } from '../../admin-auth/admin-users.repository';
import { toAdminUserModel } from '../models/to-admin-user-model.util';
import { AdminUsersPageModel } from '../models/admin-users-page.model';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Same phase-1 pagination convention as `ListUserAccountsService`: real
 * `limit`/`offset`, clamped to a max page size, no server-side filter/sort
 * arguments yet — the admin panel's grid does its own client-side
 * filtering/sorting on the fetched page. */
@Injectable()
export class ListAdminUsersService {
  constructor(private readonly adminUsersRepository: AdminUsersRepository) {}

  async listAdminUsers(
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminUsersPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const [rows, totalCount] = await Promise.all([
      this.adminUsersRepository.findManyForAdmin({ limit, offset }),
      this.adminUsersRepository.countAllForAdmin(),
    ]);

    const page = new AdminUsersPageModel();
    page.items = rows.map(toAdminUserModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
