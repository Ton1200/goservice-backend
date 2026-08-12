import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { extractAdminBearerToken } from '../services/authenticate-admin-request.util';

/**
 * "Soft" extraction of the raw bearer token — the admin parallel of
 * `src/auth/decorators/session-token.decorator.ts`'s `@SessionToken()`.
 * No `AdminSessionPort` lookup, no validation, no guard required, never
 * throws. Used by `adminLogout`, which must stay idempotent even with no
 * token to revoke.
 */
export const AdminSessionToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const req = GqlExecutionContext.create(context).getContext<{
      req: { headers: { authorization?: string } };
    }>().req;
    return extractAdminBearerToken(req.headers.authorization);
  },
);
