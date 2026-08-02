import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { SessionPort } from '../ports/session.port';
import { authenticateRequest } from './authenticate-request.util';

interface RequestWithSession {
  headers: { authorization?: string };
  userId?: string;
}

/**
 * Reusable, cross-cutting "must be logged in" guard — apply
 * `@UseGuards(SessionGuard)` to any GraphQL mutation/query that requires an
 * active session, in any module. Not GOS-7-specific: `SessionPort`
 * (`../ports/session.port.ts`) was built forward-looking for exactly this,
 * and this guard is its first caller.
 *
 * Reads the `Authorization` header via `GqlExecutionContext`, same
 * technique as `GqlThrottlerGuard`
 * (`../../common/guards/gql-throttler.guard.ts`) uses to reach `req`/`res`
 * from the Apollo GraphQL execution context instead of
 * `switchToHttp()`. The actual header-parsing + `SessionPort` lookup logic
 * lives in `authenticateRequest()` (`./authenticate-request.util.ts`) as a
 * plain function, kept here as a thin Nest adapter so that logic can be
 * unit-tested without a `GqlExecutionContext` mock.
 *
 * On success, attaches the resolved `userId` to the request object so
 * `@CurrentUser()` (`../decorators/current-user.decorator.ts`) can read it
 * back out in the protected resolver method.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessionPort: SessionPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = GqlExecutionContext.create(context).getContext<{
      req: RequestWithSession;
    }>().req;

    req.userId = await authenticateRequest(
      req.headers.authorization,
      this.sessionPort,
    );
    return true;
  }
}
