import { EngagementStatus } from '@prisma/client';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { EngagementChatRepository } from './engagement-chat.repository';
import { EngagementMessageFieldResolver } from './engagement-message-field.resolver';
import { EngagementMessageModel } from './models/engagement-message.model';

describe('EngagementMessageFieldResolver (engagementStatus)', () => {
  function makeMessage(
    overrides?: Partial<EngagementMessageModel>,
  ): EngagementMessageModel {
    const message = new EngagementMessageModel();
    message.id = 'message-1';
    message.conversationId = 'conversation-1';
    Object.assign(message, overrides);
    return message;
  }

  function makeResolver(status: EngagementStatus) {
    const findConversationById = jest.fn().mockResolvedValue({
      id: 'conversation-1',
      engagementId: 'engagement-1',
    });
    const engagementChatRepository = {
      findConversationById,
    } as unknown as EngagementChatRepository;

    const findById = jest.fn().mockResolvedValue({
      id: 'engagement-1',
      status,
    });
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    return {
      resolver: new EngagementMessageFieldResolver(
        engagementChatRepository,
        engagementsRepository,
      ),
      findConversationById,
      findById,
    };
  }

  it("resolves the message's Conversation, then that Conversation's Engagement status", async () => {
    const { resolver, findConversationById, findById } = makeResolver(
      EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    );

    const status = await resolver.engagementStatus(makeMessage());

    expect(findConversationById).toHaveBeenCalledWith('conversation-1');
    expect(findById).toHaveBeenCalledWith('engagement-1');
    expect(status).toBe(EngagementStatus.PENDING_CUSTOMER_CONFIRMATION);
  });
});
