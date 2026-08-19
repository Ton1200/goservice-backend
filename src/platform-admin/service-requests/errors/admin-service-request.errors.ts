import { DomainException } from '../../../common/errors/domain-exception';

const NOT_FOUND_CODE = 'ADMIN_SERVICE_REQUEST_NOT_FOUND';

/**
 * Thrown by `GetAdminServiceRequestDetailService` when `id` doesn't resolve
 * to a real `ServiceRequest`. Safe and correct to surface as a specific,
 * clear error here — same reasoning as `userAccountNotFound()`: this is an
 * internal admin tool, the caller is already authenticated, and the admin
 * only ever reaches this by selecting a row from their own `serviceRequests`
 * query result — there is no enumeration risk to protect against.
 */
export function adminServiceRequestNotFound(id: string): DomainException {
  return new DomainException(
    NOT_FOUND_CODE,
    `No ServiceRequest exists with id "${id}".`,
  );
}
