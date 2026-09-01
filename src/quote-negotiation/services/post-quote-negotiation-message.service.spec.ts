import { Logger } from '@nestjs/common';
import { QuoteNegotiationParty, QuoteStatus } from '@prisma/client';
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
    );

    return {
      service,
      resolveParty,
      isEnabled,
      createMessage,
      supersedePendingProposals,
      createPriceProposal,
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
});
