import { DomainException } from '../../../common/errors/domain-exception';

const NOT_FOUND_CODE = 'ADMIN_QUOTE_NOT_FOUND';

/**
 * Thrown by `GetAdminQuoteDetailService` when `id` doesn't resolve to a real
 * `Quote`. Safe and correct to surface as a specific, clear error here —
 * same reasoning as `adminServiceRequestNotFound()`: this is an internal
 * admin tool, the caller is already authenticated, and the admin only ever
 * reaches this by selecting a row from their own `quotes` query result —
 * there is no enumeration risk to protect against.
 */
export function adminQuoteNotFound(id: string): DomainException {
  return new DomainException(
    NOT_FOUND_CODE,
    `No Quote exists with id "${id}".`,
  );
}
