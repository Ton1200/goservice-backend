import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { EngagementStatus } from '../engagements/models/engagement-status.enum';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { EngagementChatRepository } from './engagement-chat.repository';
import { EngagementMessageModel } from './models/engagement-message.model';

/**
 * GOS-125 — resolves `EngagementMessage.engagementStatus`, the
 * work-execution lifecycle status of the `Engagement` this message's
 * Conversation belongs to, so the coordination chat surface can show it
 * without a separate `Engagement` query. A message links to `Engagement`
 * only through its Conversation (`EngagementChatMessage.conversationId` -&gt;
 * `EngagementChatConversation.engagementId`) — there is no direct
 * `engagementId` on `EngagementMessageModel` itself — so this resolves in
 * two hops: Conversation by id, then Engagement by its `engagementId`.
 *
 * Both repositories are already provided directly in
 * `EngagementChatModule.providers` (same "reuse the concrete repository
 * class directly" pattern `ServiceRequestFieldResolver` establishes) — no
 * new module wiring needed beyond registering this resolver class itself.
 *
 * Two notes worth flagging (documented, not blockers):
 * - `EngagementMessageModel` is reused by the platform-admin
 *   `adminEngagementChatThread` query (see that model's own header comment
 *   on `imageUrl`'s identical reuse) — `engagementStatus` transparently
 *   appears there too, even though this resolver itself isn't
 *   permission-gated; acceptable since the parent admin query already
 *   requires `Permission.ENGAGEMENT_CHAT_READ`.
 * - Every message returned by one `engagementMessages`/
 *   `adminEngagementChatThread` call belongs to the SAME conversation/
 *   Engagement, so resolving this field across N messages in one response is
 *   N pairs of queries all landing on the same two rows — a more redundant
 *   instance of this codebase's already-accepted "no batched Dataloader
 *   added speculatively" posture than the generic per-row case
 *   `ServiceRequestFieldResolver`'s own header comment documents.
 */
@Resolver(() => EngagementMessageModel)
export class EngagementMessageFieldResolver {
  constructor(
    private readonly engagementChatRepository: EngagementChatRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  @ResolveField(() => EngagementStatus, {
    name: 'engagementStatus',
    description:
      "The work-execution lifecycle status of this message's Engagement (ACCEPTED/IN_PROGRESS/PENDING_CUSTOMER_CONFIRMATION/COMPLETED/CANCELLED).",
  })
  async engagementStatus(
    @Parent() message: EngagementMessageModel,
  ): Promise<EngagementStatus> {
    const conversation =
      await this.engagementChatRepository.findConversationById(
        message.conversationId,
      );
    const engagement = await this.engagementsRepository.findById(
      conversation!.engagementId,
    );
    // A resolved message's conversationId always points at a live
    // Conversation, and that Conversation's engagementId always points at a
    // live Engagement (both Cascade-delete together) — same
    // non-null-assertion idiom used throughout this codebase for
    // referentially-guaranteed lookups.
    return engagement!.status;
  }
}
