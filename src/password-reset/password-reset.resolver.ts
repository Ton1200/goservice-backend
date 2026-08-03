import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { RequestPasswordResetPayload } from './models/request-password-reset-payload.model';
import { ResetPasswordInput } from './models/reset-password-input.model';
import { ResetPasswordPayload } from './models/reset-password-payload.model';
import { RequestPasswordResetService } from './services/request-password-reset.service';
import { ResetPasswordService } from './services/reset-password.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `UsersResolver`/`AuthResolver`. Each method delegates entirely to its
 * application service.
 *
 * Rate-limit note: the `@Throttle` limits below are an ADDITIONAL,
 * raw-request-rate layer on top of Redis, same rationale as
 * `users.resolver.ts`'s header comment — the PRIMARY controls
 * (attemptsCount/cooldown) are DB-durable, enforced inside
 * `RequestPasswordResetService`/`ResetPasswordService`.
 */
@Resolver()
export class PasswordResetResolver {
  constructor(
    private readonly requestPasswordResetService: RequestPasswordResetService,
    private readonly resetPasswordService: ResetPasswordService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Mutation(() => RequestPasswordResetPayload, {
    description:
      'Requests a password-reset code by email, subject to a cooldown. Always returns the same neutral result regardless of whether the account exists, is a social-only account, or is not eligible.',
  })
  requestPasswordReset(
    @Args('email') email: string,
  ): Promise<RequestPasswordResetPayload> {
    return this.requestPasswordResetService.requestPasswordReset(email);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Mutation(() => ResetPasswordPayload, {
    description:
      "Confirms a password-reset code and sets a new password, revoking all of the user's active sessions on success.",
  })
  resetPassword(
    @Args('input') input: ResetPasswordInput,
  ): Promise<ResetPasswordPayload> {
    return this.resetPasswordService.resetPassword(input);
  }
}
