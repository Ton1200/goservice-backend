import { DomainException } from '../../../common/errors/domain-exception';
import { AdminSessionPort } from '../ports/admin-session.port';

const BEARER_PREFIX = 'Bearer ';

/**
 * The single indistinguishable failure result for "this admin request isn't
 * authenticated" — `ADMIN_UNAUTHENTICATED`, deliberately a DIFFERENT code
 * from the consumer schema's `UNAUTHENTICATED` (see
 * `src/auth/guards/authenticate-request.util.ts`'s own `unauthenticated()`)
 * so the two schemas' error vocabularies never accidentally cross-match if
 * the two frontends were ever mis-wired.
 */
function adminUnauthenticated(): DomainException {
  return new DomainException(
    'ADMIN_UNAUTHENTICATED',
    'Admin authentication required.',
  );
}

/**
 * Extracts the bearer token from an `Authorization` header — a
 * from-scratch duplicate of `src/auth/guards/authenticate-request.util.ts`'s
 * `extractBearerToken`, not an import from it (zero shared code between the
 * consumer and admin session mechanisms).
 */
export function extractAdminBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * The "must be a logged-in admin" check, extracted as a plain, Nest-free
 * function so it can be unit-tested without a `GqlExecutionContext` mock —
 * see `../guards/admin-session.guard.ts`, whose `canActivate` is a thin
 * wrapper around this. Resolves to the authenticated `adminUserId` on
 * success; throws `DomainException('ADMIN_UNAUTHENTICATED', ...)` for every
 * failure mode (missing header, malformed header, or a token that doesn't
 * map to a currently ACTIVE, unexpired `AdminSession`).
 */
export async function authenticateAdminRequest(
  authorizationHeader: string | undefined,
  adminSessionPort: AdminSessionPort,
): Promise<string> {
  const token = extractAdminBearerToken(authorizationHeader);
  const adminUserId = token
    ? await adminSessionPort.findActiveSessionAdminUserId(token)
    : null;

  if (!adminUserId) {
    throw adminUnauthenticated();
  }
  return adminUserId;
}
