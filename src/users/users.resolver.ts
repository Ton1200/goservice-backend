import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { RegisterInput } from './models/register-input.model';
import { RegisterPayload } from './models/register-payload.model';
import { VerifyEmailCodeInput } from './models/verify-email-code-input.model';
import { VerifyEmailCodePayload } from './models/verify-email-code-payload.model';
import { ResendVerificationCodePayload } from './models/resend-verification-code-payload.model';
import { RegisterUserService } from './services/register-user.service';
import { VerifyEmailCodeService } from './services/verify-email-code.service';
import { ResendVerificationCodeService } from './services/resend-verification-code.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `SystemStatusResolver`. Each method delegates entirely to its
 * application service. `login`/`socialLogin`/`logout` moved to
 * `AuthResolver` (`src/auth/`) — see that module's header comment.
 *
 * Rate-limit note: the `@Throttle` limits below are an ADDITIONAL,
 * raw-request-rate layer on top of Redis. For `verifyEmailCode` and
 * `resendVerificationCode`, the PRIMARY controls are the DB-durable
 * `attemptsCount` limit and cooldown enforced inside their services (see
 * `verify-email-code.service.ts` / `resend-verification-code.service.ts`)
 * — Redis throttling here only bounds how fast raw requests can arrive,
 * not the business-level attempt/cooldown policy.
 */
@Resolver()
export class UsersResolver {
  constructor(
    private readonly registerUserService: RegisterUserService,
    private readonly verifyEmailCodeService: VerifyEmailCodeService,
    private readonly resendVerificationCodeService: ResendVerificationCodeService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => RegisterPayload, {
    description: 'Registers a new user account with email and password.',
  })
  register(@Args('input') input: RegisterInput): Promise<RegisterPayload> {
    return this.registerUserService.register(input);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Mutation(() => VerifyEmailCodePayload, {
    description: "Verifies a user's 6-digit email verification code.",
  })
  verifyEmailCode(
    @Args('input') input: VerifyEmailCodeInput,
  ): Promise<VerifyEmailCodePayload> {
    return this.verifyEmailCodeService.verifyEmailCode(input);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Mutation(() => ResendVerificationCodePayload, {
    description:
      'Requests a new email verification code, subject to a cooldown.',
  })
  resendVerificationCode(
    @Args('email') email: string,
  ): Promise<ResendVerificationCodePayload> {
    return this.resendVerificationCodeService.resendVerificationCode(email);
  }
}
