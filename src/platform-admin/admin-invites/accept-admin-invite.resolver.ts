import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AcceptAdminInviteService } from './services/accept-admin-invite.service';
import { AcceptAdminInviteInput } from './models/accept-admin-invite.input';
import { AcceptAdminInvitePayload } from './models/accept-admin-invite-payload.model';

/**
 * The ONE resolver in this entire feature with NO `@UseGuards(...)` at all
 * — DELIBERATELY its own, separate class from `AdminInvitesResolver`
 * (`admin-invites.resolver.ts`): a class-level `@UseGuards(...)` there would
 * apply to every method on that class regardless of what's decorated on the
 * method itself, so `acceptAdminInvite` MUST live somewhere that class-level
 * guard can never reach. Reachable by anyone with a valid invite link,
 * unauthenticated — see `AcceptAdminInviteService`'s own header comment for
 * the anti-enumeration design this backs.
 *
 * `@Throttle` here mirrors `resetPassword`'s own limit (20/min) — the
 * closest existing precedent for "an unauthenticated-reachable mutation that
 * accepts a token/code and sets a new password" in this codebase.
 */
@Resolver()
export class AcceptAdminInviteResolver {
  constructor(
    private readonly acceptAdminInviteService: AcceptAdminInviteService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Mutation(() => AcceptAdminInvitePayload, {
    description:
      "Confirms an admin-invite token and sets the new admin's initial password, activating their account (status -> ACTIVE). Every invalid case (token does not exist, already consumed, already invalidated, or expired) returns the SAME generic ADMIN_INVITE_TOKEN_INVALID_OR_EXPIRED result — no distinction is ever revealed. Issues no session — the new admin must call adminLogin separately afterward.",
  })
  acceptAdminInvite(
    @Args('input') input: AcceptAdminInviteInput,
  ): Promise<AcceptAdminInvitePayload> {
    return this.acceptAdminInviteService.acceptAdminInvite(input);
  }
}
