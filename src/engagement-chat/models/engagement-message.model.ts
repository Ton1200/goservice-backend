import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { EngagementChatParty } from './engagement-chat-party.enum';

/**
 * One free-text coordination message in an Engagement's Chat de
 * Coordinación thread — GOS-46. Deliberately carries NO structured business
 * field (no price, no status) — a deliberate divergence from
 * `QuoteNegotiationMessageModel` (which optionally carries a
 * `priceProposal`): this thread can never touch `Quote`/`Engagement` state,
 * `content` is the only payload.
 */
@ObjectType('EngagementMessage')
export class EngagementMessageModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  conversationId!: string;

  @Field(() => EngagementChatParty)
  senderRole!: EngagementChatParty;

  @Field()
  content!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
