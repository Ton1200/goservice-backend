import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_NOT_FOUND_CODE = 'QUOTE_NOT_FOUND';

/**
 * Thrown for ANY case where a `Quote` id either does not exist AT ALL, or
 * exists but does not belong to the caller (whether the caller is the
 * Professional who submitted it, or the Customer who owns the
 * `ServiceRequest` it was submitted against) — deliberately the SAME code
 * for both cases, same anti-enumeration discipline as
 * `service-requests/errors/service-request-not-found.error.ts`'s own
 * `serviceRequestNotFound()`.
 */
export function quoteNotFound(): DomainException {
  return new DomainException(QUOTE_NOT_FOUND_CODE, 'Quote not found.');
}
