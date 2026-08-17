import { DomainException } from '../../common/errors/domain-exception';

/**
 * Defensive-only fallback for `AccountApprovedGuard` when `req.userId` is
 * somehow unset despite being paired with `SessionGuard` (which should
 * always set it first) — mirrors `authenticateRequest()`'s own
 * `UNAUTHENTICATED` code (`src/auth/guards/authenticate-request.util.ts`),
 * reused here rather than imported directly since that helper's own
 * `unauthenticated()` factory is module-private.
 */
export function authenticationRequired(): DomainException {
  return new DomainException('UNAUTHENTICATED', 'Authentication required.');
}
