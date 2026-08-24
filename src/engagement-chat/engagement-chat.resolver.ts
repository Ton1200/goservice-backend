import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { EngagementChatModuleEnabledGuard } from './guards/engagement-chat-module-enabled.guard';
import { EngagementMessageModel } from './models/engagement-message.model';
import { SendEngagementMessageInput } from './models/send-engagement-message-input.model';
import { ListEngagementMessagesService } from './services/list-engagement-messages.service';
import { SendEngagementMessageService } from './services/send-engagement-message.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `QuoteNegotiationResolver`. Both operations require `SessionGuard` +
 * `AccountApprovedGuard` + `EngagementChatModuleEnabledGuard`, in that exact
 * order (the module-enabled guard added as a follow-up — see that guard's
 * own header comment, `src/engagement-chat/guards/
 * engagement-chat-module-enabled.guard.ts`, mirroring
 * `QuoteNegotiationResolver`'s own guard chain). Neither accepts
 * `customerProfileId`/`professionalProfileId`/`userId` as an argument —
 * ownership/role is always derived server-side from `@CurrentUser()` +
 * `EngagementChatAccessService`.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard, EngagementChatModuleEnabledGuard)
export class EngagementChatResolver {
  constructor(
    private readonly sendEngagementMessageService: SendEngagementMessageService,
    private readonly listEngagementMessagesService: ListEngagementMessagesService,
  ) {}

  @Mutation(() => EngagementMessageModel, {
    description:
      "Sends a free-text coordination message on an Engagement the caller is a party to (its CustomerProfile or ProfessionalProfile). Creates the underlying Conversation transparently on the first message for this Engagement — there is no separate 'create conversation' operation.",
  })
  sendEngagementMessage(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('input') input: SendEngagementMessageInput,
  ): Promise<EngagementMessageModel> {
    return this.sendEngagementMessageService.sendMessage(
      userId,
      engagementId,
      input,
    );
  }

  @Query(() => [EngagementMessageModel], {
    description:
      'The full coordination message history of an Engagement the caller is a party to, oldest first. Returns an empty list if no message was ever sent yet.',
  })
  engagementMessages(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementMessageModel[]> {
    return this.listEngagementMessagesService.listMessages(
      userId,
      engagementId,
    );
  }
}
