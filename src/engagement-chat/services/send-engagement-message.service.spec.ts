import { Logger } from '@nestjs/common';
import { EngagementChatParty } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EngagementChatAccessService,
  EngagementChatPartyResolution,
} from '../engagement-chat-access.service';
import { EngagementChatRepository } from '../engagement-chat.repository';
import { SendEngagementMessageService } from './send-engagement-message.service';

describe('SendEngagementMessageService', () => {
  function makeParty(
    overrides?: Partial<EngagementChatPartyResolution>,
  ): EngagementChatPartyResolution {
    return {
      role: EngagementChatParty.CUSTOMER,
      engagement: { id: 'engagement-1', status: 'ACCEPTED' } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: {
    party?: EngagementChatPartyResolution;
    resolvePartyRejects?: Error;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const resolveParty = overrides?.resolvePartyRejects
      ? jest.fn().mockRejectedValue(overrides.resolvePartyRejects)
      : jest.fn().mockResolvedValue(overrides?.party ?? makeParty());
    const accessService = {
      resolveParty,
    } as unknown as EngagementChatAccessService;

    const upsertConversation = jest.fn().mockResolvedValue({
      id: 'conversation-1',
      engagementId: 'engagement-1',
    });
    const createMessage = jest.fn().mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      senderRole: EngagementChatParty.CUSTOMER,
      content: 'Hola',
    });
    const engagementChatRepository = {
      upsertConversation,
      createMessage,
    } as unknown as EngagementChatRepository;

    const service = new SendEngagementMessageService(
      prisma,
      accessService,
      engagementChatRepository,
    );

    return { service, resolveParty, upsertConversation, createMessage };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('creates the Conversation transparently (idempotent upsert) alongside the message on the first send — no separate create step, no error', async () => {
    const { service, upsertConversation, createMessage } = makeService();

    const result = await service.sendMessage('user-1', 'engagement-1', {
      content: '¿A qué hora te viene bien?',
    });

    expect(upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'engagement-1',
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({
        conversationId: 'conversation-1',
        senderRole: EngagementChatParty.CUSTOMER,
        senderCustomerProfileId: 'customer-profile-1',
        senderProfessionalProfileId: null,
        content: '¿A qué hora te viene bien?',
      }),
    );
    expect(result.id).toBe('message-1');
  });

  it("attaches the caller's PROFESSIONAL role/profile when the party resolution says so", async () => {
    const { service, createMessage } = makeService({
      party: makeParty({
        role: EngagementChatParty.PROFESSIONAL,
        customerProfileId: null,
        professionalProfileId: 'professional-profile-1',
      }),
    });

    await service.sendMessage('user-2', 'engagement-1', {
      content: 'Mañana a las 9hs, ¿te sirve?',
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        senderRole: EngagementChatParty.PROFESSIONAL,
        senderCustomerProfileId: null,
        senderProfessionalProfileId: 'professional-profile-1',
      }),
    );
  });

  it('a third party (neither Customer nor Professional on this Engagement) is blocked from sending — ENGAGEMENT_NOT_FOUND, propagated from EngagementChatAccessService', async () => {
    const { service, upsertConversation } = makeService({
      resolvePartyRejects: Object.assign(new Error('Engagement not found.'), {
        code: 'ENGAGEMENT_NOT_FOUND',
      }),
    });

    await expect(
      service.sendMessage('third-party-user', 'engagement-1', {
        content: 'Hola',
      }),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(upsertConversation).not.toHaveBeenCalled();
  });
});
