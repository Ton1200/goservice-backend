import { Field, InputType } from '@nestjs/graphql';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Structurally closed input — no `senderRole`/`customerProfileId`/
 * `professionalProfileId` field, no `proposedPrice`-shaped field of any
 * kind. The sender's role/profile is ALWAYS resolved server-side from
 * `@CurrentUser()` + `EngagementChatAccessService.resolveParty`, same
 * pattern `PostQuoteNegotiationMessageInput` already establishes for its
 * own author. This is a deliberate, permanent divergence from
 * `PostQuoteNegotiationMessageInput` (not a temporary omission) — Engagement
 * Chat is coordination-only and must never grow a price/business-state
 * field.
 *
 * `min(1)`/`max(2000)` on `content` mirror
 * `PostQuoteNegotiationMessageInput.message`'s own
 * reasonable-but-not-confirmed-as-a-product-rule bounds.
 */
@InputType()
export class SendEngagementMessageInput {
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
