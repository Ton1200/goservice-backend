import { DomainException } from '../../common/errors/domain-exception';
import { SessionPort } from '../ports/session.port';

const BEARER_PREFIX = 'Bearer ';

/**
 * The single indistinguishable failure result for "this request isn't
 * authenticated" — same anti-enumeration principle as
 * `authenticationFailed()` (`../errors/authentication-failed.error.ts`) for
 * `login`/`socialLogin`: the client only needs to know THAT it must log in
 * again, never WHY (missing header vs. malformed header vs. an
 * unknown/expired/revoked token are all indistinguishable from the
 * outside).
 */
function unauthenticated(): DomainException {
  return new DomainException('UNAUTHENTICATED', 'Authentication required.');
}

/**
 * Extracts the bearer token from an `Authorization` header. Requires the
 * exact, case-sensitive `Bearer <token>` shape (single space, non-empty
 * token) — anything else (missing header, wrong scheme/case, no token) is
 * treated as absent, not partially parsed.
 *
 * Exported so it can be reused by primitives that need the raw token
 * WITHOUT the "throw if absent/invalid" behavior of `authenticateRequest()`
 * below — see `../decorators/session-token.decorator.ts` (`@SessionToken()`),
 * the "soft" counterpart to `@CurrentUser()`.
 */
export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * The actual "must be logged in" check, extracted as a plain, Nest-free
 * function so it can be unit-tested without constructing a
 * `GqlExecutionContext`/`ExecutionContext` mock — see `session.guard.ts`,
 * whose `canActivate` is a thin wrapper around this. Resolves to the
 * authenticated `userId` on success; throws `DomainException('UNAUTHENTICATED', ...)`
 * for every failure mode (missing header, malformed header, or a token
 * that doesn't map to a currently ACTIVE, unexpired session).
 */
export async function authenticateRequest(
  authorizationHeader: string | undefined,
  sessionPort: SessionPort,
): Promise<string> {
  const token = extractBearerToken(authorizationHeader);
  const userId = token
    ? await sessionPort.findActiveSessionUserId(token)
    : null;

  if (!userId) {
    throw unauthenticated();
  }
  return userId;
}
