import { Permission } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';

/**
 * Thrown by `AdminLockoutGuardService.assertPermissionRemainsGranted` when a
 * proposed role-permissions edit or admin-user edit would leave the system
 * with zero `ACTIVE` `AdminUser`s holding `permission` (in practice, always
 * `Permission.ADMIN_USERS_MANAGE` — this feature's own self-lockout guard,
 * see that service's own header comment). Disclosable to any authenticated
 * admin — never an anti-enumeration-sensitive code.
 */
export function wouldLockOutAdminManagement(
  permission: Permission,
): DomainException {
  return new DomainException(
    'WOULD_LOCK_OUT_ADMIN_MANAGEMENT',
    `This change would leave no ACTIVE admin holding ${permission} anywhere in the system — rejected to prevent locking out admin management entirely.`,
  );
}
