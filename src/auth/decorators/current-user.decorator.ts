import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Pulls the `userId` that `SessionGuard` (`../guards/session.guard.ts`)
 * attached to the request. Usable as `@CurrentUser() userId: string` in any
 * resolver method also decorated with `@UseGuards(SessionGuard)` — see
 * `auth.resolver.ts`'s `me` query for the reference usage. Only meaningful
 * behind `SessionGuard`: without it, `req.userId` is never set.
 *
 * "Hard" requirement — this is the validated, throws-if-absent/invalid
 * counterpart to `@SessionToken()` (`./session-token.decorator.ts`), which
 * does a "soft", never-throwing raw-token extraction for operations (like
 * `logout`) that must tolerate a missing/invalid token instead of being
 * rejected outright.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const req = GqlExecutionContext.create(context).getContext<{
      req: { userId?: string };
    }>().req;
    return req.userId as string;
  },
);
