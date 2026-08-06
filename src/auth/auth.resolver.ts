import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { SocialLoginInput } from './models/social-login-input.model';
import { LoginInput } from './models/login-input.model';
import { LoginPayload } from './models/login-payload.model';
import { SocialLoginService } from './services/social-login.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { SessionToken } from './decorators/session-token.decorator';
import { SessionGuard } from './guards/session.guard';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `UsersResolver`/`SystemStatusResolver`. Each method delegates entirely to
 * its application service.
 *
 * Rate-limit note: the `@Throttle` limits below are an ADDITIONAL,
 * raw-request-rate layer on top of Redis — see `users.resolver.ts`'s own
 * header comment for the fuller rationale (shared across both resolvers).
 */
@Resolver()
export class AuthResolver {
  constructor(
    private readonly socialLoginService: SocialLoginService,
    private readonly loginService: LoginService,
    private readonly logoutService: LogoutService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => LoginPayload, {
    description:
      'Logs in via a Google/Apple identity token. Auto-registers a new account the first time a given social identity is seen, unless its email already belongs to another account (in which case authentication fails — accounts are never auto-merged).',
  })
  socialLogin(@Args('input') input: SocialLoginInput): Promise<LoginPayload> {
    return this.socialLoginService.socialLogin(input);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => LoginPayload, {
    description:
      'Logs in with email and password, issuing a new session on success.',
  })
  login(@Args('input') input: LoginInput): Promise<LoginPayload> {
    return this.loginService.login(input);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Mutation(() => Boolean, {
    description:
      'Revokes the session identified by the Authorization: Bearer <token> header. Idempotent — never throws.',
  })
  logout(@SessionToken() sessionToken: string | null): Promise<boolean> {
    return this.logoutService.logout(sessionToken);
  }

  /**
   * Reference implementation for `@UseGuards(SessionGuard)` +
   * `@CurrentUser()` — copy this pattern to protect any future
   * mutation/query that requires an active session. Not a product feature
   * on its own; it exists purely so future stories have a working example
   * to copy instead of reinventing session validation. See
   * `guards/session.guard.ts` / `decorators/current-user.decorator.ts` and
   * `goservice-docs/knowledge/implementation-patterns.md`.
   */
  @UseGuards(SessionGuard)
  @Query(() => ID, {
    description:
      'Reference-only query returning the authenticated userId. Demonstrates the @UseGuards(SessionGuard) + @CurrentUser() pattern; not a real product feature.',
  })
  me(@CurrentUser() userId: string): string {
    return userId;
  }
}
