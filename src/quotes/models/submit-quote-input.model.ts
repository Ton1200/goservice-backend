import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Structurally closed input — no `professionalProfileId`/`userId` field.
 * The owning `ProfessionalProfile` is ALWAYS resolved server-side from
 * `@CurrentUser()` (see `SubmitQuoteService`) — same pattern
 * `PublishServiceRequestInput` already establishes.
 *
 * `price` is only `@IsInt()` here — the `> 0` business check is done in
 * `SubmitQuoteService` via `invalidQuotePrice()`, not a `@Min()` decorator,
 * so the specific `INVALID_QUOTE_PRICE` GraphQL error code is what the
 * client actually sees (see that error's own comment).
 *
 * `min(1)`/`max(2000)` on `message` are reasonable defaults, NOT a
 * confirmed business rule — same caveat
 * `PublishServiceRequestInput.description` already documents for its own
 * length bounds.
 */
@InputType()
export class SubmitQuoteInput {
  @Field(() => ID)
  @IsUUID('4')
  serviceRequestId!: string;

  @Field(() => Int)
  @IsInt()
  price!: number;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
