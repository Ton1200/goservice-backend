import { Logger } from '@nestjs/common';
import {
  MediaUploadRefIntendedUse,
  QuoteNegotiationParty,
  QuoteStatus,
} from '@prisma/client';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  QuoteNegotiationAccessService,
  QuoteNegotiationPartyResolution,
} from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { PostQuoteNegotiationMessageService } from './post-quote-negotiation-message.service';

describe('PostQuoteNegotiationMessageService', () => {
  function makeParty(
    overrides?: Partial<QuoteNegotiationPartyResolution>,
  ): QuoteNegotiationPartyResolution {
    return {
      role: QuoteNegotiationParty.CUSTOMER,
      quote: { id: 'quote-1', status: QuoteStatus.SENT } as never,
      serviceRequest: { id: 'service-request-1' } as never,
      customerProfileId: 'customer-profile-1',
      professionalProfileId: null,
      ...overrides,
    };
  }

  function makeService(overrides?: {
    party?: QuoteNegotiationPartyResolution;
    resolvePartyRejects?: Error;
    isEnabled?: boolean;
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
    } as unknown as QuoteNegotiationAccessService;

    const isEnabled = jest.fn().mockResolvedValue(overrides?.isEnabled ?? true);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;

    const createMessage = jest
      .fn()
      .mockResolvedValue({ id: 'message-1', quoteId: 'quote-1' });
    const supersedePendingProposals = jest.fn().mockResolvedValue({ count: 1 });
    const createPriceProposal = jest
      .fn()
      .mockResolvedValue({ id: 'proposal-1', proposedPrice: 5000 });
    const quoteNegotiationRepository = {
      createMessage,
      supersedePendingProposals,
      createPriceProposal,
    } as unknown as QuoteNegotiationRepository;

    const service = new PostQuoteNegotiationMessageService(
      prisma,
      accessService,
      platformSettingPort,
      quoteNegotiationRepository,
      mediaUploadsRepository,
    );

    return {
      service,
      resolveParty,
      isEnabled,
      createMessage,
      supersedePendingProposals,
      createPriceProposal,
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

  it('posts a plain comment (no proposedPrice) without touching QuotePriceProposal at all', async () => {
    const {
      service,
      createMessage,
      supersedePendingProposals,
      createPriceProposal,
    } = makeService();

    const result = await service.postMessage('user-1', 'quote-1', {
      message: 'Hola, ¿podemos ajustar el precio?',
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({ quoteId: 'quote-1' }),
    );
    expect(supersedePendingProposals).not.toHaveBeenCalled();
    expect(createPriceProposal).not.toHaveBeenCalled();
    expect(result.priceProposal).toBeNull();
  });

  it('a new PENDING proposal auto-supersedes the prior PENDING one — supersede runs BEFORE create, never two PENDING at once', async () => {
    const { service, supersedePendingProposals, createPriceProposal } =
      makeService();
    const callOrder: string[] = [];
    supersedePendingProposals.mockImplementation(() => {
      callOrder.push('supersede');
      return Promise.resolve({ count: 1 });
    });
    createPriceProposal.mockImplementation(() => {
      callOrder.push('create');
      return Promise.resolve({ id: 'proposal-1', proposedPrice: 5000 });
    });

    await service.postMessage('user-1', 'quote-1', {
      message: 'Te propongo un nuevo precio.',
      proposedPrice: 5000,
    });

    expect(callOrder).toEqual(['supersede', 'create']);
  });

  it('throws QUOTE_PRICE_PROPOSAL_DISABLED_FOR_CUSTOMER when a Customer proposes a price while their flag is off — the price is never silently dropped, the whole mutation fails', async () => {
    const { service, isEnabled, createMessage } = makeService({
      party: makeParty({ role: QuoteNegotiationParty.CUSTOMER }),
      isEnabled: false,
    });

    await expect(
      service.postMessage('user-1', 'quote-1', {
        message: 'Propongo un precio menor.',
        proposedPrice: 4000,
      }),
    ).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_DISABLED_FOR_CUSTOMER',
    });

    expect(isEnabled).toHaveBeenCalledWith(
      'quote-negotiation.price-edit.customer-can-propose',
    );
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('throws QUOTE_PRICE_PROPOSAL_DISABLED_FOR_PROFESSIONAL when a Professional proposes a price while their flag is off', async () => {
    const { service, isEnabled, createMessage } = makeService({
      party: makeParty({
        role: QuoteNegotiationParty.PROFESSIONAL,
        customerProfileId: null,
        professionalProfileId: 'professional-profile-1',
      }),
      isEnabled: false,
    });

    await expect(
      service.postMessage('user-1', 'quote-1', {
        message: 'Te propongo un precio mayor.',
        proposedPrice: 6000,
      }),
    ).rejects.toMatchObject({
      code: 'QUOTE_PRICE_PROPOSAL_DISABLED_FOR_PROFESSIONAL',
    });

    expect(isEnabled).toHaveBeenCalledWith(
      'quote-negotiation.price-edit.professional-can-propose',
    );
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('throws QUOTE_NOT_NEGOTIABLE when the Quote is not SENT', async () => {
    const { service } = makeService({
      party: makeParty({
        quote: { id: 'quote-1', status: QuoteStatus.ACCEPTED } as never,
      }),
    });

    await expect(
      service.postMessage('user-1', 'quote-1', { message: 'Hola' }),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_NEGOTIABLE' });
  });

  it('a third party (neither Customer nor Professional on this Quote) is blocked from posting — QUOTE_NOT_FOUND, propagated from QuoteNegotiationAccessService', async () => {
    const { service } = makeService({
      resolvePartyRejects: Object.assign(new Error('Quote not found.'), {
        code: 'QUOTE_NOT_FOUND',
      }),
    });

    await expect(
      service.postMessage('third-party-user', 'quote-1', { message: 'Hola' }),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  // GOS-72 — optional reference image via a consumed MediaUploadRef.

  it('persists imageUrl null and never touches media uploads when no mediaUploadRefId is supplied', async () => {
    const { service, createMessage, findUsablePendingRefs, markConsumed } =
      makeService();

    await service.postMessage('user-1', 'quote-1', { message: 'Hola' });

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
        usableRefs: [{ id: 'ref-1', fileUrl: 'http://x/ref.webp' }],
      });

    await service.postMessage('user-1', 'quote-1', {
      message: 'Mirá esta referencia',
      mediaUploadRefId: 'ref-1',
    });

    expect(findUsablePendingRefs).toHaveBeenCalledWith(
      'user-1',
      ['ref-1'],
      MediaUploadRefIntendedUse.QUOTE_NEGOTIATION_MESSAGE_IMAGE,
    );
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({ imageUrl: 'http://x/ref.webp' }),
    );
    expect(markConsumed).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      ['ref-1'],
    );
  });

  it('lets an image and a price proposal coexist on the same message', async () => {
    const { service, createMessage, createPriceProposal } = makeService({
      usableRefs: [{ id: 'ref-1', fileUrl: 'http://x/ref.webp' }],
    });

    const result = await service.postMessage('user-1', 'quote-1', {
      message: 'Nuevo precio + foto',
      proposedPrice: 5000,
      mediaUploadRefId: 'ref-1',
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageUrl: 'http://x/ref.webp' }),
    );
    expect(createPriceProposal).toHaveBeenCalled();
    expect(result.priceProposal).toMatchObject({ id: 'proposal-1' });
  });

  it('throws INVALID_MEDIA_UPLOAD_REF and never creates the message when the ref is unusable', async () => {
    const { service, createMessage } = makeService({ usableRefs: [] });

    await expect(
      service.postMessage('user-1', 'quote-1', {
        message: 'Hola',
        mediaUploadRefId: 'ref-x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rolls back with INVALID_MEDIA_UPLOAD_REF when the consume write loses a race (count !== 1)', async () => {
    const { service } = makeService({
      usableRefs: [{ id: 'ref-1', fileUrl: 'http://x/ref.webp' }],
      consumedCount: 0,
    });

    await expect(
      service.postMessage('user-1', 'quote-1', {
        message: 'Hola',
        mediaUploadRefId: 'ref-1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
  });
});
