import { EngagementChatRepository } from '../engagement-chat.repository';
import { EmitEngagementLifecycleSystemMessageService } from './emit-engagement-lifecycle-system-message.service';

describe('EmitEngagementLifecycleSystemMessageService', () => {
  const fakeTx = { __fakeTransactionClient: true } as never;

  function makeService(overrides?: {
    conversation?: { id: string; engagementId: string } | null;
  }) {
    const findConversationByEngagementId = jest
      .fn()
      .mockResolvedValue(
        overrides?.conversation === undefined
          ? { id: 'conversation-1', engagementId: 'engagement-1' }
          : overrides.conversation,
      );
    const createSystemMessage = jest.fn().mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      senderRole: 'SYSTEM',
      content: 'El profesional inició el trabajo',
    });
    const engagementChatRepository = {
      findConversationByEngagementId,
      createSystemMessage,
    } as unknown as EngagementChatRepository;

    const service = new EmitEngagementLifecycleSystemMessageService(
      engagementChatRepository,
    );

    return { service, findConversationByEngagementId, createSystemMessage };
  }

  it('creates a SYSTEM message when a Conversation already exists for the Engagement', async () => {
    const { service, findConversationByEngagementId, createSystemMessage } =
      makeService();

    await service.emit(
      fakeTx,
      'engagement-1',
      'El profesional inició el trabajo',
    );

    expect(findConversationByEngagementId).toHaveBeenCalledWith(
      'engagement-1',
      fakeTx,
    );
    expect(createSystemMessage).toHaveBeenCalledWith(
      fakeTx,
      'conversation-1',
      'El profesional inició el trabajo',
    );
  });

  it('is a no-op — never creates a Conversation or a message — when none exists yet for the Engagement', async () => {
    const { service, createSystemMessage } = makeService({
      conversation: null,
    });

    await service.emit(
      fakeTx,
      'engagement-1',
      'El profesional inició el trabajo',
    );

    expect(createSystemMessage).not.toHaveBeenCalled();
  });
});
