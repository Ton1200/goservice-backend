import { Logger } from '@nestjs/common';
import { EngagementChatParty, MediaUploadRefIntendedUse } from '@prisma/client';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
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
    usableRefs?: { id: string; fileUrl: string }[];
    consumedCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findUsablePendingRefs = jest
      .fn()
      .mockResolvedValue(overrides?.usableRefs ?? []);
    const markConsumed = jest
      .fn()
      .mockImplementation((_tx, ids: string[]) =>
        Promise.resolve({ count: overrides?.consumedCount ?? ids.length }),
      );
    const mediaUploadsRepository = {
      findUsablePendingRefs,
      markConsumed,
    } as unknown as MediaUploadsRepository;

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
      mediaUploadsRepository,
    );

    return {
      service,
      resolveParty,
      upsertConversation,
      createMessage,
      findUsablePendingRefs,
      markConsumed,
    };
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

  // GOS-72 — optional coordination image via a consumed MediaUploadRef.

  it('persists imageUrl null and never touches media uploads when no mediaUploadRefId is supplied', async () => {
    const { service, createMessage, findUsablePendingRefs, markConsumed } =
      makeService();

    await service.sendMessage('user-1', 'engagement-1', { content: 'Hola' });

    expect(findUsablePendingRefs).not.toHaveBeenCalled();
    expect(markConsumed).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageUrl: null }),
    );
  });

  it('sets imageUrl from the consumed ref and marks it CONSUMED in the same transaction', async () => {
    const { service, createMessage, findUsablePendingRefs, markConsumed } =
      makeService({
        usableRefs: [{ id: 'ref-1', fileUrl: 'http://x/site.webp' }],
      });

    await service.sendMessage('user-1', 'engagement-1', {
      content: 'Así quedó el acceso',
      mediaUploadRefId: 'ref-1',
    });

    expect(findUsablePendingRefs).toHaveBeenCalledWith(
      'user-1',
      ['ref-1'],
      MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({ imageUrl: 'http://x/site.webp' }),
    );
    expect(markConsumed).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      ['ref-1'],
    );
  });

  it('throws INVALID_MEDIA_UPLOAD_REF and never creates the message when the ref is unusable (missing / wrong intendedUse / expired / consumed)', async () => {
    const { service, createMessage } = makeService({ usableRefs: [] });

    await expect(
      service.sendMessage('user-1', 'engagement-1', {
        content: 'Hola',
        mediaUploadRefId: 'ref-x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rolls back with INVALID_MEDIA_UPLOAD_REF when the consume write loses a race (count !== 1)', async () => {
    const { service } = makeService({
      usableRefs: [{ id: 'ref-1', fileUrl: 'http://x/site.webp' }],
      consumedCount: 0,
    });

    await expect(
      service.sendMessage('user-1', 'engagement-1', {
        content: 'Hola',
        mediaUploadRefId: 'ref-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
  });
});
