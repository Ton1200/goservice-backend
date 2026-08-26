import type { AdminUserRow } from '../../admin-auth/admin-users.repository';
import { toAdminRoleModel } from '../../admin-roles/models/to-admin-role-model.util';
import { AdminUserModel } from './admin-user.model';

/** Maps an `AdminUsersRepository.ADMIN_USER_SELECT`-shaped row to the
 * GraphQL-facing `AdminUserModel`, nesting its role via
 * `toAdminRoleModel`. */
export function toAdminUserModel(row: AdminUserRow): AdminUserModel {
  const model = new AdminUserModel();
  model.id = row.id;
  model.email = row.email;
  model.displayName = row.displayName;
  model.status = row.status;
  model.role = toAdminRoleModel(row.role);
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}
