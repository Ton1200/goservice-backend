import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { extractBearerToken } from '../guards/authenticate-request.util';

/**
 * "Soft" extraction of the raw bearer token from the `Authorization`
 * header — deliberately the lighter-weight counterpart to `@CurrentUser()`
 * (`./current-user.decorator.ts`):
 *
 * - `@CurrentUser()` = HARD requirement. Only usable behind
 *   `@UseGuards(SessionGuard)`, which validates the token against
 *   `SessionPort` and THROWS `DomainException('UNAUTHENTICATED', ...)` for
 *   any failure (missing/malformed header, unknown/expired/revoked token).
 *   Use it for operations that require an already-active session to run at
 *   all (e.g. `me`).
 *
 * - `@SessionToken()` = SOFT extraction. No `SessionPort` lookup, no
 *   validation, no guard required, never throws — it just parses the
 *   `Authorization` header via `extractBearerToken()`
 *   (`../guards/authenticate-request.util.ts`) and returns the raw token,
 *   or `null` if the header is missing/malformed. Use it for operations
 *   that must tolerate "missing/invalid token" as a normal, non-error case
 *   and decide for themselves what to do about it — the reference example
 *   is `logout` (`../auth.resolver.ts`), which must stay idempotent and
 *   never throw even when there's no token to revoke.
 */
export const SessionToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const req = GqlExecutionContext.create(context).getContext<{
      req: { headers: { authorization?: string } };
    }>().req;
    return extractBearerToken(req.headers.authorization);
  },
);
