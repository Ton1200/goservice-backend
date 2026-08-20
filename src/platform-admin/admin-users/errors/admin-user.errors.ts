import { AdminUserStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';

/** Thrown by `UpdateAdminUserService`/`ResendAdminInviteService` (and
 * indirectly reachable via `InviteAdminUserService`/other admin-user reads)
 * when `id`/`adminUserId` doesn't resolve to a real `AdminUser`. Safe and
 * correct to surface as a specific, clear error: this is an internal admin
 * tool, the caller is already authenticated, and only ever reaches this by
 * having selected a row from their own `adminUsers` query result — no
 * enumeration risk to protect here (same reasoning as
 * `userAccountNotFound`). */
export function adminUserNotFound(id: string): DomainException {
  return new DomainException(
    'ADMIN_USER_NOT_FOUND',
    `No AdminUser exists with id "${id}".`,
  );
}

/** Thrown by `InviteAdminUserService` when `email` already belongs to an
 * existing `AdminUser`. */
export function adminUserEmailTaken(): DomainException {
  return new DomainException(
    'ADMIN_USER_EMAIL_TAKEN',
    'An admin user with that email already exists.',
  );
}

/** Thrown by `ResendAdminInviteService` when the target `AdminUser` is not
 * currently `INVITED` (already `ACTIVE`, or already `REVOKED`) — resending
 * an invite only makes sense for an admin who hasn't accepted one yet. */
export function adminUserNotInvited(id: string): DomainException {
  return new DomainException(
    'ADMIN_USER_NOT_INVITED',
    `AdminUser "${id}" is not currently INVITED — there is no pending invite to resend.`,
  );
}

/** Thrown by `UpdateAdminUserService` when `input.status` is `INVITED` —
 * that status is only ever reachable via the invite flow itself
 * (`inviteAdminUser`), never a manual status edit through this mutation. */
export function adminUserInvalidStatusTransition(
  status: AdminUserStatus,
): DomainException {
  return new DomainException(
    'ADMIN_USER_INVALID_STATUS_TRANSITION',
    `Cannot set an admin user's status to ${status} directly — INVITED is only reachable via the invite flow.`,
  );
}

/** The self-revocation guard (`UpdateAdminUserService`) — independent of
 * the self-lockout guard, checked FIRST (cheaper — a plain id comparison,
 * no extra DB read): an admin can never revoke their own account, even if
 * another ACTIVE admin still holds ADMIN_USERS_MANAGE and the lockout guard
 * would otherwise allow it. */
export function cannotRevokeOwnAccount(): DomainException {
  return new DomainException(
    'CANNOT_REVOKE_OWN_ACCOUNT',
    'You cannot revoke your own admin account.',
  );
}

/** `DeleteAdminUserService`'s own self-delete guard — same reasoning as
 * `cannotRevokeOwnAccount()`, a distinct code because deleting is a
 * different, more consequential action than revoking (revoking is
 * reversible via `updateAdminUser`; deleting is not). */
export function cannotDeleteOwnAccount(): DomainException {
  return new DomainException(
    'CANNOT_DELETE_OWN_ACCOUNT',
    'You cannot delete your own admin account.',
  );
}

/** Thrown by `DeleteAdminUserService` when the target `AdminUser` has ever
 * been the actor of at least one `AdminAuditLog` row —
 * `AdminAuditLog.actorAdminUser` is `onDelete: Restrict`, so this is a real
 * DB-level impossibility, not just a business rule (see
 * `AuditLogRepository.countByActor`'s own header comment). Suggests Revoke
 * as the practical alternative, since in practice most admins who have ever
 * done anything in this panel will hit this. */
export function adminUserHasAuditHistory(): DomainException {
  return new DomainException(
    'ADMIN_USER_HAS_AUDIT_HISTORY',
    'This admin user has audit history and cannot be permanently deleted — revoke their access instead.',
  );
}
