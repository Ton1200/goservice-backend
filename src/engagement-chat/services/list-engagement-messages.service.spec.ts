import { EngagementChatAccessService } from '../engagement-chat-access.service';
import { EngagementChatRepository } from '../engagement-chat.repository';
import { ListEngagementMessagesService } from './list-engagement-messages.service';

describe('ListEngagementMessagesService', () => {
  function makeService(overrides?: { resolvePartyRejects?: Error }) {
    const resolveParty = overrides?.resolvePartyRejects
      ? jest.fn().mockRejectedValue(overrides.resolvePartyRejects)
      : jest.fn().mockResolvedValue({ role: 'CUSTOMER' });
    const accessService = {
      resolveParty,
    } as unknown as EngagementChatAccessService;

    const messages = [
      { id: 'message-1', conversationId: 'conversation-1' },
      { id: 'message-2', conversationId: 'conversation-1' },
    ];
    const findMessagesByEngagementId = jest.fn().mockResolvedValue(messages);
    const engagementChatRepository = {
      findMessagesByEngagementId,
    } as unknown as EngagementChatRepository;

    const service = new ListEngagementMessagesService(
      accessService,
      engagementChatRepository,
    );

    return { service, resolveParty, findMessagesByEngagementId, messages };
  }

  it('returns the message history for a caller who is a party to the Engagement', async () => {
    const { service, resolveParty, findMessagesByEngagementId, messages } =
      makeService();

    const result = await service.listMessages('user-1', 'engagement-1');

    expect(resolveParty).toHaveBeenCalledWith('user-1', 'engagement-1');
    expect(findMessagesByEngagementId).toHaveBeenCalledWith('engagement-1');
    expect(result).toBe(messages);
  });

  it('blocks a third party (neither Customer nor Professional on this Engagement) from reading — ENGAGEMENT_NOT_FOUND, propagated from EngagementChatAccessService, and the repository is never queried', async () => {
    const { service, findMessagesByEngagementId } = makeService({
      resolvePartyRejects: Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    });

    await expect(
      service.listMessages('third-party-user', 'engagement-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(findMessagesByEngagementId).not.toHaveBeenCalled();
  });
});
