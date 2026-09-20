import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { LedgerRepository } from '../ledger.repository';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { GetMyPaymentBalanceService } from './get-my-payment-balance.service';

describe('GetMyPaymentBalanceService', () => {
  function makeService(overrides?: {
    professionalProfile?: { id: string } | null;
    balance?: number;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? { id: 'professional-1' }
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const sumProfessionalBalance = jest
      .fn()
      .mockResolvedValue(overrides?.balance ?? 0);
    const ledgerRepository = {
      sumProfessionalBalance,
    } as unknown as LedgerRepository;

    const service = new GetMyPaymentBalanceService(
      profilesRepository,
      ledgerRepository,
    );
    return { service, findProfessionalProfileByUserId, sumProfessionalBalance };
  }

  it("returns the Professional's current balance, whatever its sign", async () => {
    const { service, sumProfessionalBalance } = makeService({ balance: -2300 });

    await expect(service.getMyPaymentBalance('user-1')).resolves.toBe(-2300);
    expect(sumProfessionalBalance).toHaveBeenCalledWith('professional-1');
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED for a caller with no ProfessionalProfile, without querying the ledger', async () => {
    const { service, sumProfessionalBalance } = makeService({
      professionalProfile: null,
    });

    await expect(service.getMyPaymentBalance('user-1')).rejects.toMatchObject({
      code: professionalProfileRequired().code,
    });
    expect(sumProfessionalBalance).not.toHaveBeenCalled();
  });
});
