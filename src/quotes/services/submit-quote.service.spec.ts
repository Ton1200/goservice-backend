import { Logger } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { QuotesRepository } from '../quotes.repository';
import { SubmitQuoteInput } from '../models/submit-quote-input.model';
import { SubmitQuoteService } from './submit-quote.service';

describe('SubmitQuoteService', () => {
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'user-1',
  };

  function makeServiceRequest(
    overrides?: Partial<{ status: ServiceRequestStatus }>,
  ) {
    return {
      id: 'service-request-1',
      customerProfileId: 'customer-profile-1',
      status: overrides?.status ?? ServiceRequestStatus.OPEN,
    };
  }

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    serviceRequest?: ReturnType<typeof makeServiceRequest> | null;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? professionalProfile
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const serviceRequest =
      overrides?.serviceRequest === undefined
        ? makeServiceRequest()
        : overrides.serviceRequest;
    const findById = jest.fn().mockResolvedValue(serviceRequest);
    const serviceRequestsRepository = {
      findById,
    } as unknown as ServiceRequestsRepository;

    const create = jest.fn().mockResolvedValue({
      id: 'quote-1',
      serviceRequestId: 'service-request-1',
      professionalProfileId: professionalProfile.id,
      price: 5000,
      message: 'Puedo hacerlo mañana.',
      status: 'SENT',
    });
    const quotesRepository = { create } as unknown as QuotesRepository;

    const service = new SubmitQuoteService(
      profilesRepository,
      serviceRequestsRepository,
      quotesRepository,
    );

    return { service, findById, create };
  }

  function validInput(overrides?: Partial<SubmitQuoteInput>): SubmitQuoteInput {
    return {
      serviceRequestId: 'service-request-1',
      price: 5000,
      message: 'Puedo hacerlo mañana.',
      ...overrides,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('submits a Quote against an OPEN ServiceRequest', async () => {
    const { service, create } = makeService();

    const result = await service.submitQuote('user-1', validInput());

    expect(create).toHaveBeenCalledWith({
      serviceRequestId: 'service-request-1',
      professionalProfileId: professionalProfile.id,
      price: 5000,
      message: 'Puedo hacerlo mañana.',
    });
    expect(result.id).toBe('quote-1');
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(
      service.submitQuote('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_REQUIRED' });
  });

  it('throws SERVICE_REQUEST_NOT_FOUND for a nonexistent ServiceRequest', async () => {
    const { service } = makeService({ serviceRequest: null });

    await expect(
      service.submitQuote('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_FOUND' });
  });

  it('throws SERVICE_REQUEST_NOT_OPEN for a CANCELLED ServiceRequest', async () => {
    const { service } = makeService({
      serviceRequest: makeServiceRequest({
        status: ServiceRequestStatus.CANCELLED,
      }),
    });

    await expect(
      service.submitQuote('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_OPEN' });
  });

  it('throws SERVICE_REQUEST_NOT_OPEN for an ENGAGED ServiceRequest', async () => {
    const { service } = makeService({
      serviceRequest: makeServiceRequest({
        status: ServiceRequestStatus.ENGAGED,
      }),
    });

    await expect(
      service.submitQuote('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUEST_NOT_OPEN' });
  });

  it('throws INVALID_QUOTE_PRICE for a zero price', async () => {
    const { service, create } = makeService();

    await expect(
      service.submitQuote('user-1', validInput({ price: 0 })),
    ).rejects.toMatchObject({ code: 'INVALID_QUOTE_PRICE' });
    expect(create).not.toHaveBeenCalled();
  });

  it('throws INVALID_QUOTE_PRICE for a negative price', async () => {
    const { service } = makeService();

    await expect(
      service.submitQuote('user-1', validInput({ price: -100 })),
    ).rejects.toMatchObject({ code: 'INVALID_QUOTE_PRICE' });
  });
});
