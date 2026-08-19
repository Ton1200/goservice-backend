import { Logger } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { QuotesRepository } from '../quotes.repository';
import { WithdrawQuoteService } from './withdraw-quote.service';

describe('WithdrawQuoteService', () => {
  const professionalProfile = {
    id: 'professional-profile-1',
    userId: 'user-1',
  };

  function makeExisting(
    overrides?: Partial<{ professionalProfileId: string }>,
  ) {
    return {
      id: 'quote-1',
      serviceRequestId: 'service-request-1',
      professionalProfileId:
        overrides?.professionalProfileId ?? professionalProfile.id,
      status: 'SENT',
    };
  }

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    existing?: ReturnType<typeof makeExisting> | null;
    withdrawCount?: number;
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

    const existing =
      overrides?.existing === undefined ? makeExisting() : overrides.existing;
    const withdrawn = { ...(existing ?? makeExisting()), status: 'WITHDRAWN' };
    const findById = jest
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(withdrawn);
    const withdraw = jest
      .fn()
      .mockResolvedValue({ count: overrides?.withdrawCount ?? 1 });
    const quotesRepository = {
      findById,
      withdraw,
    } as unknown as QuotesRepository;

    const service = new WithdrawQuoteService(
      profilesRepository,
      quotesRepository,
    );

    return { service, findById, withdraw };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("withdraws the caller's own SENT Quote", async () => {
    const { service, withdraw } = makeService();

    const result = await service.withdrawQuote('user-1', 'quote-1');

    expect(withdraw).toHaveBeenCalledWith('quote-1');
    expect(result.status).toBe('WITHDRAWN');
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(
      service.withdrawQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_REQUIRED' });
  });

  it('throws QUOTE_NOT_FOUND for a nonexistent Quote', async () => {
    const { service } = makeService({ existing: null });

    await expect(service.withdrawQuote('user-1', 'nope')).rejects.toMatchObject(
      { code: 'QUOTE_NOT_FOUND' },
    );
  });

  it("throws QUOTE_NOT_FOUND (same code) for another professional's Quote", async () => {
    const { service } = makeService({
      existing: makeExisting({ professionalProfileId: 'someone-elses' }),
    });

    await expect(
      service.withdrawQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('throws QUOTE_NOT_SENT when the CAS loses a race (e.g. against a concurrent acceptQuote)', async () => {
    const { service, withdraw } = makeService({ withdrawCount: 0 });

    await expect(
      service.withdrawQuote('user-1', 'quote-1'),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_SENT' });
    expect(withdraw).toHaveBeenCalledWith('quote-1');
  });
});
