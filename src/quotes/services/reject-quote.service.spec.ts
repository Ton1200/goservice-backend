import { Logger } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { QuotesRepository } from '../quotes.repository';
import { RejectQuoteService } from './reject-quote.service';

describe('RejectQuoteService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };

  function makeExisting() {
    return {
      id: 'quote-1',
      serviceRequestId: 'service-request-1',
      professionalProfileId: 'professional-profile-1',
      status: 'SENT',
    };
  }

  function makeServiceRequest(
    overrides?: Partial<{ customerProfileId: string }>,
  ) {
    return {
      id: 'service-request-1',
      customerProfileId: overrides?.customerProfileId ?? customerProfile.id,
    };
  }

  function makeService(overrides?: {
    customerProfile?: typeof customerProfile | null;
    existing?: ReturnType<typeof makeExisting> | null;
    serviceRequest?: ReturnType<typeof makeServiceRequest> | null;
    rejectCount?: number;
  }) {
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

    const serviceRequest =
      overrides?.serviceRequest === undefined
        ? makeServiceRequest()
        : overrides.serviceRequest;
    const findByIdSr = jest.fn().mockResolvedValue(serviceRequest);
    const serviceRequestsRepository = {
      findById: findByIdSr,
    } as unknown as ServiceRequestsRepository;

    const existing =
      overrides?.existing === undefined ? makeExisting() : overrides.existing;
    const rejected = { ...(existing ?? makeExisting()), status: 'REJECTED' };
    const findById = jest
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(rejected);
    const reject = jest
      .fn()
      .mockResolvedValue({ count: overrides?.rejectCount ?? 1 });
    const quotesRepository = {
      findById,
      reject,
    } as unknown as QuotesRepository;

    const service = new RejectQuoteService(
      profilesRepository,
      serviceRequestsRepository,
      quotesRepository,
    );

    return { service, findByIdSr, reject };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("rejects a SENT Quote on the caller's own ServiceRequest", async () => {
    const { service, reject } = makeService();

    const result = await service.rejectQuote('user-1', 'quote-1');

    expect(reject).toHaveBeenCalledWith('quote-1');
    expect(result.status).toBe('REJECTED');
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the caller has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.rejectQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('throws QUOTE_NOT_FOUND for a nonexistent Quote', async () => {
    const { service } = makeService({ existing: null });

    await expect(service.rejectQuote('user-1', 'nope')).rejects.toMatchObject({
      code: 'QUOTE_NOT_FOUND',
    });
  });

  it("throws QUOTE_NOT_FOUND (same code) for a Quote on another customer's ServiceRequest", async () => {
    const { service } = makeService({
      serviceRequest: makeServiceRequest({
        customerProfileId: 'someone-elses-profile',
      }),
    });

    await expect(
      service.rejectQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('throws QUOTE_NOT_SENT when the CAS loses a race', async () => {
    const { service, reject } = makeService({ rejectCount: 0 });

    await expect(
      service.rejectQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_SENT' });
    expect(reject).toHaveBeenCalledWith('quote-1');
  });
});
