import { QuoteNegotiationParty } from '@prisma/client';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { QuotesRepository } from '../quotes/quotes.repository';
import { ServiceRequestsRepository } from '../service-requests/service-requests.repository';
import { QuoteNegotiationAccessService } from './quote-negotiation-access.service';

describe('QuoteNegotiationAccessService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'customer-user' };
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'professional-user',
  };
  const quote = {
    id: 'quote-1',
    serviceRequestId: 'service-request-1',
    professionalProfileId: professionalProfile.id,
    status: 'SENT',
  };
  const serviceRequest = {
    id: 'service-request-1',
    customerProfileId: customerProfile.id,
    status: 'OPEN',
  };

  function makeService(overrides?: {
    quote?: typeof quote | null;
    serviceRequest?: typeof serviceRequest | null;
    customerProfile?: typeof customerProfile | null;
    professionalProfile?: typeof professionalProfile | null;
  }) {
    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.quote === undefined ? quote : overrides.quote,
      );
    const quotesRepository = { findById } as unknown as QuotesRepository;

    const findByIdSr = jest
      .fn()
      .mockResolvedValue(
        overrides?.serviceRequest === undefined
          ? serviceRequest
          : overrides.serviceRequest,
      );
    const serviceRequestsRepository = {
      findById: findByIdSr,
    } as unknown as ServiceRequestsRepository;

    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? null
          : overrides.customerProfile,
      );
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? null
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const service = new QuoteNegotiationAccessService(
      profilesRepository,
      quotesRepository,
      serviceRequestsRepository,
    );

    return { service };
  }

  it('resolves the owning Customer as CUSTOMER', async () => {
    const { service } = makeService({ customerProfile });

    const result = await service.resolveParty('customer-user', 'quote-1');

    expect(result).toMatchObject({
      role: QuoteNegotiationParty.CUSTOMER,
      customerProfileId: customerProfile.id,
      professionalProfileId: null,
    });
  });

  it('resolves the submitting Professional as PROFESSIONAL', async () => {
    const { service } = makeService({ professionalProfile });

    const result = await service.resolveParty('professional-user', 'quote-1');

    expect(result).toMatchObject({
      role: QuoteNegotiationParty.PROFESSIONAL,
      customerProfileId: null,
      professionalProfileId: professionalProfile.id,
    });
  });

  it('tryResolveParty returns null for a third party (neither Customer nor Professional on this Quote)', async () => {
    const { service } = makeService({
      customerProfile: { id: 'someone-elses-customer-profile', userId: 'x' },
      professionalProfile: {
        id: 'someone-elses-professional-profile',
        userId: 'x',
      },
    });

    const result = await service.tryResolveParty('third-party-user', 'quote-1');

    expect(result).toBeNull();
  });

  it('resolveParty throws QUOTE_NOT_FOUND (anti-enumeration) for a third party', async () => {
    const { service } = makeService();

    await expect(
      service.resolveParty('third-party-user', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('resolveParty throws QUOTE_NOT_FOUND (same code) for a nonexistent Quote', async () => {
    const { service } = makeService({ quote: null });

    await expect(
      service.resolveParty('customer-user', 'nope'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });
});
