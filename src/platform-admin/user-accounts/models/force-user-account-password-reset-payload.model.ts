import { Field, ObjectType } from '@nestjs/graphql';

/**
 * `success` is `true` for any call that got past every gate
 * (`USER_ACCOUNTS_WRITE`, `EnsureEmailDeliveryAvailableService`, the target
 * user existing) — including the case where the underlying resend cooldown
 * made this call a no-op for actually sending a NEW email (a code was very
 * recently issued already). Unlike the consumer-facing
 * `requestPasswordReset`, there is no anti-enumeration reason to hide that
 * distinction here, but this round keeps the payload minimal (a single
 * boolean) rather than speculatively exposing an `issued`/`alreadyPending`
 * split nothing in the UI needs yet.
 */
@ObjectType()
export class ForceUserAccountPasswordResetPayload {
  @Field()
  success!: boolean;
}
