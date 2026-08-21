import { Injectable } from '@nestjs/common';
import { AdminRolesRepository } from '../../admin-rbac/admin-roles.repository';
import { AdminRoleModel } from '../models/admin-role.model';
import { toAdminRoleModel } from '../models/to-admin-role-model.util';

/** No pagination — the seeded-plus-admin-created `AdminRole` set is a small
 * catalog (mirrors `ListAdminCategoriesService`'s own "small catalog, no
 * pagination" precedent). */
@Injectable()
export class ListAdminRolesService {
  constructor(private readonly adminRolesRepository: AdminRolesRepository) {}

  async listAdminRoles(): Promise<AdminRoleModel[]> {
    const rows = await this.adminRolesRepository.findAll();
    return rows.map(toAdminRoleModel);
  }
}
