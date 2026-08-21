import { DomainException } from '../../../common/errors/domain-exception';

/** Thrown by `UpdateAdminRolePermissionsService`/`DeleteAdminRoleService`
 * (and reused by `InviteAdminUserService`/`UpdateAdminUserService` for a
 * nonexistent `roleId`) when `id`/`roleId` doesn't resolve to a real
 * `AdminRole`. */
export function adminRoleNotFound(id: string): DomainException {
  return new DomainException(
    'ADMIN_ROLE_NOT_FOUND',
    `No AdminRole exists with id "${id}".`,
  );
}

/** Thrown by `CreateAdminRoleService` when `name` already belongs to an
 * existing `AdminRole` (case-sensitive — `AdminRole.name` is `@unique` at
 * the DB level with no case-folding, unlike `Category.name`'s own
 * deliberately-stricter case-insensitive check). */
export function adminRoleNameTaken(name: string): DomainException {
  return new DomainException(
    'ADMIN_ROLE_NAME_TAKEN',
    `An AdminRole named "${name}" already exists.`,
  );
}

/** Thrown by `DeleteAdminRoleService` when `name` is one of the 3 fixed,
 * seeded roles (`SEEDED_ADMIN_ROLE_NAMES`) — non-renamable, non-deletable.
 * Their PERMISSION SETS remain fully editable via
 * `updateAdminRolePermissions` — this is a NAME-only restriction, never
 * applied to that mutation. */
export function adminRoleIsSystemRole(name: string): DomainException {
  return new DomainException(
    'ADMIN_ROLE_IS_SYSTEM_ROLE',
    `"${name}" is one of the 3 seeded system roles and cannot be deleted.`,
  );
}

/** Thrown by `DeleteAdminRoleService` when at least one `AdminUser` still
 * references this role — mirrors `DeleteCategoryService`'s "in use"
 * pre-check; Postgres's own `onDelete: Restrict` on `AdminUser.roleId` is
 * the backstop underneath this friendlier, earlier error. */
export function adminRoleInUse(count: number): DomainException {
  return new DomainException(
    'ADMIN_ROLE_IN_USE',
    `This role cannot be deleted: it is still assigned to ${count} admin user${count === 1 ? '' : 's'}.`,
  );
}
