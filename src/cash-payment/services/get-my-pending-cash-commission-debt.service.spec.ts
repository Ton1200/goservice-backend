import { ProfilesRepository } from '../../profiles/profiles.repository';
import { LedgerRepository } from '../../ledger/ledger.repository';
import { GetMyPendingCashCommissionDebtService } from './get-my-pending-cash-commission-debt.service';

describe('GetMyPendingCashCommissionDebtService', () => {
  function makeService(overrides?: {
    professionalProfile?: { id: string; userId: string } | null;
    sum?: number;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? { id: 'professional-profile-1', userId: 'user-1' }
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const sumCashCommissionDebtForProfessional = jest
      .fn()
      .mockResolvedValue(overrides?.sum ?? 0);
    const ledgerRepository = {
      sumCashCommissionDebtForProfessional,
    } as unknown as LedgerRepository;

    const service = new GetMyPendingCashCommissionDebtService(
      profilesRepository,
      ledgerRepository,
    );

    return { service, sumCashCommissionDebtForProfessional };
  }

  it('sums every CASH_COMMISSION_DEBT entry for the caller’s own ProfessionalProfile', async () => {
    const { service, sumCashCommissionDebtForProfessional } = makeService({
      sum: 1500,
    });

    const result = await service.getMyPendingCashCommissionDebt('user-1');

    expect(result).toBe(1500);
    expect(sumCashCommissionDebtForProfessional).toHaveBeenCalledWith(
      'professional-profile-1',
    );
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(
      service.getMyPendingCashCommissionDebt('user-1'),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_REQUIRED' });
  });
});
