import { LedgerRepository } from '../../../ledger/ledger.repository';
import { GetAdminPlatformBalanceService } from './get-admin-platform-balance.service';

describe('GetAdminPlatformBalanceService', () => {
  it("passes through LedgerRepository.sumPlatformBalance's result", async () => {
    const sumPlatformBalance = jest.fn().mockResolvedValue(123456);
    const ledgerRepository = {
      sumPlatformBalance,
    } as unknown as LedgerRepository;
    const service = new GetAdminPlatformBalanceService(ledgerRepository);

    await expect(service.getPlatformBalance()).resolves.toBe(123456);
    expect(sumPlatformBalance).toHaveBeenCalledTimes(1);
  });
});
