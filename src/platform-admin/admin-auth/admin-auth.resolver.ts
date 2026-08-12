import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AdminLoginInput } from './models/admin-login-input.model';
import { AdminLoginPayload } from './models/admin-login-payload.model';
import { AdminLoginService } from './services/admin-login.service';
import { AdminLogoutService } from './services/admin-logout.service';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminSessionToken } from './decorators/admin-session-token.decorator';
import { AdminSessionGuard } from './guards/admin-session.guard';

/**
 * Thin delivery adapter for the `/admin/graphql` endpoint — no business
 * logic here, same pattern as the consumer schema's `AuthResolver`. Each
 * method delegates entirely to its application service.
 *
 * `adminLogin`/`adminLogout`/`adminMe` are the deviation-from-the-ticket
 * additions the platform-admin plan calls for (see its "Deviations"
 * section) — required so a bootstrapped admin can obtain and use a
 * session at all.
 *
 * Rate-limit note: `adminLogin`'s `@Throttle` limit is deliberately
 * STRICTER than the consumer `AuthResolver.login`/`socialLogin` (5/min vs.
 * 10/min) — security-review fix. `adminLogin` guards a single high-value
 * account (and, in later slices, encrypted third-party credentials) rather
 * than many consumer accounts, so it warrants at least as strict a limit,
 * arguably stricter. Same additional-layer-on-top-of-Redis rationale as
 * `AuthResolver`/`UsersResolver` — see their header comments.
 */
@Resolver()
export class AdminAuthResolver {
  constructor(
    private readonly adminLoginService: AdminLoginService,
    private readonly adminLogoutService: AdminLogoutService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Mutation(() => AdminLoginPayload, {
    description:
      'Logs an admin in with email and password, issuing a new (short-TTL) admin session on success.',
  })
  adminLogin(
    @Args('input') input: AdminLoginInput,
  ): Promise<AdminLoginPayload> {
    return this.adminLoginService.adminLogin(input);
  }

  @Mutation(() => Boolean, {
    description:
      'Revokes the admin session identified by the Authorization: Bearer <token> header. Idempotent — never throws.',
  })
  adminLogout(
    @AdminSessionToken() sessionToken: string | null,
  ): Promise<boolean> {
    return this.adminLogoutService.adminLogout(sessionToken);
  }

  @UseGuards(AdminSessionGuard)
  @Query(() => ID, {
    description: 'Returns the authenticated adminUserId.',
  })
  adminMe(@CurrentAdminUser() adminUserId: string): string {
    return adminUserId;
  }
}
