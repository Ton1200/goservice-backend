import { Logger } from '@nestjs/common';
import { QuoteStatus, ServiceRequestStatus } from '@prisma/client';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { QuotesRepository } from '../quotes.repository';
import { AcceptQuoteService } from './accept-quote.service';

describe('AcceptQuoteService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };

  function makeQuote(overrides?: Partial<{ status: QuoteStatus }>) {
    return {
      id: 'quote-1',
      serviceRequestId: 'service-request-1',
      professionalProfileId: 'professional-profile-1',
      status: overrides?.status ?? QuoteStatus.SENT,
    };
  }

  function makeServiceRequest(
    overrides?: Partial<{
      customerProfileId: string;
      status: ServiceRequestStatus;
    }>,
  ) {
    return {
      id: 'service-request-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
      status: overrides?.status ?? ServiceRequestStatus.OPEN,
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    quote?: ReturnType<typeof makeQuote> | null;
    serviceRequest?: ReturnType<typeof makeServiceRequest> | null;
    serviceRequestCasCount?: number;
    quoteCasCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? customerProfile
          : overrides.customerProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
    } as unknown as ProfilesRepository;

    const quote =
      overrides?.quote === undefined ? makeQuote() : overrides.quote;
    const findByIdQuote = jest.fn().mockResolvedValue(quote);
    const transitionToAcceptedIfSent = jest
      .fn()
      .mockResolvedValue({ count: overrides?.quoteCasCount ?? 1 });
    const rejectSiblingsSent = jest.fn().mockResolvedValue({ count: 0 });
    const quotesRepository = {
      findById: findByIdQuote,
      transitionToAcceptedIfSent,
      rejectSiblingsSent,
    } as unknown as QuotesRepository;

    const serviceRequest =
      overrides?.serviceRequest === undefined
        ? makeServiceRequest()
        : overrides.serviceRequest;
    const engagedServiceRequest = {
      ...(serviceRequest ?? makeServiceRequest()),
      status: ServiceRequestStatus.ENGAGED,
      acceptedQuoteId: quote?.id,
    };
    const findByIdSr = jest
      .fn()
      .mockResolvedValueOnce(serviceRequest)
      .mockResolvedValueOnce(engagedServiceRequest);
    const transitionToEngagedIfOpen = jest
      .fn()
      .mockResolvedValue({ count: overrides?.serviceRequestCasCount ?? 1 });
    const serviceRequestsRepository = {
      findById: findByIdSr,
      transitionToEngagedIfOpen,
    } as unknown as ServiceRequestsRepository;

    const create = jest.fn().mockResolvedValue({ id: 'engagement-1' });
    const engagementsRepository = {
      create,
    } as unknown as EngagementsRepository;

    const service = new AcceptQuoteService(
      prisma,
      profilesRepository,
      serviceRequestsRepository,
      quotesRepository,
      engagementsRepository,
    );

    return {
      service,
      $transaction,
      findByIdQuote,
      findByIdSr,
      transitionToEngagedIfOpen,
      transitionToAcceptedIfSent,
      rejectSiblingsSent,
      create,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('accepts a SENT Quote: transitions ServiceRequest to ENGAGED, Quote to ACCEPTED, rejects siblings, creates an Engagement', async () => {
    const {
      service,
      transitionToEngagedIfOpen,
      transitionToAcceptedIfSent,
      rejectSiblingsSent,
      create,
    } = makeService();

    const result = await service.acceptQuote('user-1', 'quote-1');

    expect(transitionToEngagedIfOpen).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'service-request-1',
      'quote-1',
    );
    expect(transitionToAcceptedIfSent).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'quote-1',
      'service-request-1',
    );
    expect(rejectSiblingsSent).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      'service-request-1',
      'quote-1',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      {
        serviceRequestId: 'service-request-1',
        quoteId: 'quote-1',
        customerProfileId: customerProfile.id,
        professionalProfileId: 'professional-profile-1',
      },
    );
    expect(result.status).toBe(ServiceRequestStatus.ENGAGED);
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('throws QUOTE_NOT_FOUND for a nonexistent Quote', async () => {
    const { service } = makeService({ quote: null });

    await expect(service.acceptQuote('user-1', 'nope')).rejects.toMatchObject({
      code: 'QUOTE_NOT_FOUND',
    });
  });

  it("throws QUOTE_NOT_FOUND (same code) when the Quote's ServiceRequest belongs to another Customer", async () => {
    const { service } = makeService({
      serviceRequest: makeServiceRequest({
        customerProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('throws SERVICE_REQUEST_NOT_OPEN when the pre-read ServiceRequest is not OPEN', async () => {
    const { service, transitionToEngagedIfOpen } = makeService({
      serviceRequest: makeServiceRequest({
        status: ServiceRequestStatus.ENGAGED,
      }),
    });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_OPEN' });
    expect(transitionToEngagedIfOpen).not.toHaveBeenCalled();
  });

  it('throws QUOTE_NOT_SENT when the pre-read Quote is not SENT', async () => {
    const { service, transitionToEngagedIfOpen } = makeService({
      quote: makeQuote({ status: QuoteStatus.WITHDRAWN }),
    });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_SENT' });
    expect(transitionToEngagedIfOpen).not.toHaveBeenCalled();
  });

  it('double-accept race: the ServiceRequest CAS loses (count 0) -> QUOTE_ACCEPT_CONFLICT, no further writes happen', async () => {
    const {
      service,
      transitionToEngagedIfOpen,
      transitionToAcceptedIfSent,
      rejectSiblingsSent,
      create,
    } = makeService({ serviceRequestCasCount: 0 });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_ACCEPT_CONFLICT' });

    expect(transitionToEngagedIfOpen).toHaveBeenCalledTimes(1);
    // Lost the FIRST CAS -> the transaction throws immediately, never
    // reaching the Quote CAS, the sibling-rejection bulk update, or
    // Engagement creation.
    expect(transitionToAcceptedIfSent).not.toHaveBeenCalled();
    expect(rejectSiblingsSent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('accept-vs-cancel race: the ServiceRequest CAS loses (count 0, ServiceRequest was CANCELLED concurrently) -> QUOTE_ACCEPT_CONFLICT, no Engagement created', async () => {
    const { service, create } = makeService({ serviceRequestCasCount: 0 });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_ACCEPT_CONFLICT' });
    expect(create).not.toHaveBeenCalled();
  });

  it('accept-vs-withdraw race: ServiceRequest CAS succeeds but the Quote CAS loses (count 0) -> QUOTE_ACCEPT_CONFLICT, no Engagement created, sibling-rejection never runs', async () => {
    const {
      service,
      transitionToEngagedIfOpen,
      transitionToAcceptedIfSent,
      rejectSiblingsSent,
      create,
    } = makeService({ quoteCasCount: 0 });

    await expect(
      service.acceptQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_ACCEPT_CONFLICT' });

    expect(transitionToEngagedIfOpen).toHaveBeenCalledTimes(1);
    expect(transitionToAcceptedIfSent).toHaveBeenCalledTimes(1);
    expect(rejectSiblingsSent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
