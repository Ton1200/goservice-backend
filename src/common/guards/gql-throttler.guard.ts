import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * `@nestjs/throttler`'s default `ThrottlerGuard` assumes an HTTP execution
 * context (`context.switchToHttp().getRequest()`), which is `undefined` for
 * GraphQL resolvers reached through Apollo — it needs the request/response
 * pulled from the GraphQL context instead. Registered as the global
 * `APP_GUARD` in `AppModule` in place of the stock `ThrottlerGuard`.
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    const gqlContext = GqlExecutionContext.create(context).getContext<{
      req: Record<string, unknown>;
      res: Record<string, unknown>;
    }>();
    return { req: gqlContext.req, res: gqlContext.res };
  }
}
