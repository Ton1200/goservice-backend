import { AdminRole } from '@prisma/client';
import { AdminRoleModel } from './admin-role.model';

/** Maps a bare Prisma `AdminRole` row to the GraphQL-facing `AdminRoleModel`
 * — a direct 1:1 field copy (no derived fields), kept as its own tiny util
 * anyway for the same "one place, reused everywhere" reason
 * `toUserAccountModel`/`toAdminUserModel` exist as their own utils. Reused
 * by both `ListAdminRolesService`/`CreateAdminRoleService`/
 * `UpdateAdminRolePermissionsService` AND, nested, by
 * `../../admin-users/models/to-admin-user-model.util.ts`. */
export function toAdminRoleModel(row: AdminRole): AdminRoleModel {
  const model = new AdminRoleModel();
  model.id = row.id;
  model.name = row.name;
  model.permissions = row.permissions;
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}
