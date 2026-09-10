import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { EngagementChatParty } from './engagement-chat-party.enum';

/**
 * One free-text coordination message in an Engagement's Chat de
 * Coordinación thread — GOS-46. Carries NO price/status/business-state field
 * — a deliberate divergence from `QuoteNegotiationMessageModel`: this thread
 * can never touch `Quote`/`Engagement` state.
 *
 * GOS-72 adds ONE optional `imageUrl` — a coordination image (photo of the
 * site/access/materials). A deliberate, ticket-authorised relaxation of the
 * "content is the only payload" stance: an image is coordination media, not
 * business state; this module still never writes to `Quote`/`Engagement`.
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

  // GOS-72 — optional single coordination image, set from a consumed
  // `MediaUploadRef` (see `SendEngagementMessageService`). Plain scalar
  // column; the admin `adminEngagementChatThread` surface (which reuses this
  // exact type) gets it for free, gated by its existing `ENGAGEMENT_CHAT_READ`.
  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}
