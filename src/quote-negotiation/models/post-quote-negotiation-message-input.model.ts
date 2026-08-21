import { Field, InputType, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Structurally closed input — no `authorRole`/`customerProfileId`/
 * `professionalProfileId` field. The author's role/profile is ALWAYS
 * resolved server-side from `@CurrentUser()` +
 * `QuoteNegotiationAccessService.resolveParty` (see
 * `PostQuoteNegotiationMessageService`) — same pattern `SubmitQuoteInput`
 * already establishes for `professionalProfileId`.
 *
 * `proposedPrice` is optional and only `@IsInt()` — the `> 0`-shaped
 * business validation, if any is ever added, belongs in the service layer,
 * same posture as `SubmitQuoteInput.price`/`invalidQuotePrice()`. Omitting
 * it entirely (vs. explicit `null`) means "just a comment, no price
 * proposal" — never silently coerced from a falsy value.
 *
 * `min(1)`/`max(2000)` on `message` mirror `SubmitQuoteInput.message`'s own
 * reasonable-but-not-confirmed-as-a-product-rule bounds.
 */
@InputType()
export class PostQuoteNegotiationMessageInput {
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  proposedPrice?: number;
}
