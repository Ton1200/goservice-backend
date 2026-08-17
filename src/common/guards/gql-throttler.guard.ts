import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * `@nestjs/throttler`'s default `ThrottlerGuard` assumes an HTTP execution
 * context (`context.switchToHttp().getRequest()`), which is `undefined` for
 * GraphQL resolvers reached through Apollo — it needs the request/response
 * pulled from the GraphQL context instead. Registered as the global
 * `APP_GUARD` in `AppModule` in place of the stock `ThrottlerGuard`.
 *
 * `canActivate` override (Identity Verification follow-up): this guard is
 * registered globally (`APP_GUARD`), so it runs for EVERY route in this
 * app — not just GraphQL resolvers. Before this fix, it unconditionally
 * assumed a GraphQL execution context (`GqlExecutionContext.create(...)
 * .getContext()`), which is undefined-shaped for a plain REST route —
 * `DiditWebhookController` (`src/identity-verification/controllers/`,
 * this app's first-ever REST controller) surfaced this as a real 500 on
 * EVERY webhook call, including ones that should have cleanly 401'd on an
 * invalid signature, never even reaching that check. Now: any non-GraphQL
 * execution context (`context.getType() !== 'graphql'`) is allowed through
 * UNTHROTTLED by this guard — `DiditWebhookController` applies its OWN,
 * separate, REST-context-safe rate limiting instead (`@UseGuards(ThrottlerGuard)`
 * directly on the controller — see its own header comment) rather than
 * this GraphQL-shaped one, matching the implementation plan's explicit
 * requirement that the webhook be excluded from user/session-oriented
 * throttling and have its own IP/volume-based control instead. Any FUTURE
 * REST controller added to this app would also need its own explicit
 * throttling the same way — this guard deliberately does not (and, given
 * its GraphQL-specific `getRequestResponse` below, structurally cannot)
 * provide one generically for REST routes.
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<GqlContextType>() !== 'graphql') {
      return Promise.resolve(true);
    }
    return super.canActivate(context);
  }

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
