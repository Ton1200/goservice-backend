import { CountryCode } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../../quotes/errors/professional-profile-required.error';
import { LedgerRepository } from '../ledger.repository';
import { GetMyWalletBalancesService } from './get-my-wallet-balances.service';

describe('GetMyWalletBalancesService', () => {
  function makeService(overrides?: {
    professionalProfile?: { id: string; country: CountryCode } | null;
    balances?: Array<{
      currency: string;
      balance: number;
      pendingCashCommissionDebt: number;
    }>;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? { id: 'professional-1', country: CountryCode.AR }
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const sumProfessionalBalancesByCurrency = jest
      .fn()
      .mockResolvedValue(overrides?.balances ?? []);
    const ledgerRepository = {
      sumProfessionalBalancesByCurrency,
    } as unknown as LedgerRepository;

    const service = new GetMyWalletBalancesService(
      profilesRepository,
      ledgerRepository,
    );
    return { service, sumProfessionalBalancesByCurrency };
  }

  it('returns the ARS balance as the ledger computed it', async () => {
    const rows = [
      { currency: 'ARS', balance: -2300, pendingCashCommissionDebt: 5000 },
    ];
    const { service, sumProfessionalBalancesByCurrency } = makeService({
      balances: rows,
    });

    await expect(service.getMyWalletBalances('user-1')).resolves.toEqual(rows);
    expect(sumProfessionalBalancesByCurrency).toHaveBeenCalledWith(
      'professional-1',
    );
  });

  it('returns the COP balance as the ledger computed it', async () => {
    const rows = [
      { currency: 'COP', balance: 90000, pendingCashCommissionDebt: 0 },
    ];
    const { service } = makeService({
      professionalProfile: { id: 'professional-1', country: CountryCode.CO },
      balances: rows,
    });

    await expect(service.getMyWalletBalances('user-1')).resolves.toEqual(rows);
  });

  it('keeps one row per currency instead of adding them together', async () => {
    const rows = [
      { currency: 'ARS', balance: 1000, pendingCashCommissionDebt: 0 },
      { currency: 'COP', balance: 50000, pendingCashCommissionDebt: 0 },
    ];
    const { service } = makeService({ balances: rows });

    await expect(service.getMyWalletBalances('user-1')).resolves.toEqual(rows);
  });

  it.each([
    [CountryCode.AR, 'ARS'],
    [CountryCode.CO, 'COP'],
  ])(
    'with no movements yet, returns one zero row in the currency of %s',
    async (country, currency) => {
      const { service } = makeService({
        professionalProfile: { id: 'professional-1', country },
        balances: [],
      });

      await expect(service.getMyWalletBalances('user-1')).resolves.toEqual([
        { currency, balance: 0, pendingCashCommissionDebt: 0 },
      ]);
    },
  );

  it('throws PROFESSIONAL_PROFILE_REQUIRED for a caller with no ProfessionalProfile, without querying the ledger', async () => {
    const { service, sumProfessionalBalancesByCurrency } = makeService({
      professionalProfile: null,
    });

    await expect(service.getMyWalletBalances('user-1')).rejects.toMatchObject({
      code: professionalProfileRequired().code,
    });
    expect(sumProfessionalBalancesByCurrency).not.toHaveBeenCalled();
  });
});
