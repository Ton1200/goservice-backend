import { EngagementsRepository } from '../../../engagements/engagements.repository';
import { EngagementChatRepository } from '../../../engagement-chat/engagement-chat.repository';
import { GetAdminEngagementChatThreadService } from './get-admin-engagement-chat-thread.service';

describe('GetAdminEngagementChatThreadService', () => {
  function makeService(overrides?: { engagement?: { id: string } | null }) {
    const engagement =
      overrides?.engagement === undefined
        ? { id: 'engagement-1' }
        : overrides.engagement;
    const findById = jest.fn().mockResolvedValue(engagement);
    const engagementsRepository = {
      findById,
    } as unknown as EngagementsRepository;

    const messages = [
      {
        id: 'message-1',
        conversationId: 'conversation-1',
        senderRole: 'CUSTOMER',
        content: 'Hola, ¿cuándo podés pasar?',
      },
    ];
    const findMessagesByEngagementId = jest.fn().mockResolvedValue(messages);
    const engagementChatRepository = {
      findMessagesByEngagementId,
    } as unknown as EngagementChatRepository;

    const service = new GetAdminEngagementChatThreadService(
      engagementsRepository,
      engagementChatRepository,
    );

    return { service, findById, findMessagesByEngagementId, messages };
  }

  it('returns the full coordination-chat thread for an existing Engagement — this is the admin-schema surface ENGAGEMENT_CHAT_READ gates; the permission check itself is enforced generically by AdminPermissionsGuard/RequireAdminPermissions, exercised in admin-permissions.guard.spec.ts', async () => {
    const { service, findMessagesByEngagementId, messages } = makeService();

    const result = await service.getThread('engagement-1');

    expect(findMessagesByEngagementId).toHaveBeenCalledWith('engagement-1');
    expect(result).toBe(messages);
  });

  it('throws ADMIN_ENGAGEMENT_NOT_FOUND for a nonexistent Engagement', async () => {
    const { service, findMessagesByEngagementId } = makeService({
      engagement: null,
    });

    await expect(service.getThread('nope')).rejects.toMatchObject({
      code: 'ADMIN_ENGAGEMENT_NOT_FOUND',
    });
    expect(findMessagesByEngagementId).not.toHaveBeenCalled();
  });
});
