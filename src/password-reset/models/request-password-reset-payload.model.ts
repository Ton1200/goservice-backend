import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Deliberately just one boolean field, always `true` — see the GOS-9 plan
 * §6/§9: unlike `ResendVerificationCodePayload` (which exposes
 * `nextResendAvailableAt`), this payload must carry NO field that could
 * vary by case (email exists/doesn't, social account, ineligible status,
 * within cooldown or not), because `requestPasswordReset` is public and
 * unauthenticated — any observable difference would be an enumeration
 * side-channel.
 */
@ObjectType()
export class RequestPasswordResetPayload {
  @Field()
  requested!: boolean;
}
