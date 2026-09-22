import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { LedgerRepository } from '../ledger.repository';
import { RecordCashCommissionDebtService } from './record-cash-commission-debt.service';

interface CashCommissionDebtEntryData {
  engagementId: string;
  currency: string;
  customerProfileId: string;
  professionalProfileId: string;
  amount: number;
  commissionPercentApplied: number;
}

describe('RecordCashCommissionDebtService', () => {
  const fakeTx = { __fakeTransactionClient: true } as never;

  function makeService(overrides?: { commissionPercentValue?: string | null }) {
    const getValue = jest
      .fn()
      .mockResolvedValue(
        overrides?.commissionPercentValue === undefined
          ? '10'
          : overrides.commissionPercentValue,
      );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;

    const createCashCommissionDebtEntry = jest.fn().mockResolvedValue({});
    const ledgerRepository = {
      createCashCommissionDebtEntry,
    } as unknown as LedgerRepository;

    const service = new RecordCashCommissionDebtService(
      platformSettingPort,
      ledgerRepository,
    );

    return { service, getValue, createCashCommissionDebtEntry };
  }

  const baseParams = {
    engagementId: 'engagement-1',
    quotedPrice: 5000,
    currency: 'ARS',
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
  };

  it('writes exactly ONE CASH_COMMISSION_DEBT entry, the commission share of quotedPrice, with a frozen commissionPercentApplied', async () => {
    const { service, createCashCommissionDebtEntry } = makeService({
      commissionPercentValue: '10',
    });

    await service.recordCommissionDebt(fakeTx, baseParams);

    expect(createCashCommissionDebtEntry).toHaveBeenCalledTimes(1);
    const [tx, data] = createCashCommissionDebtEntry.mock.calls[0] as [
      unknown,
      CashCommissionDebtEntryData,
    ];
    expect(tx).toBe(fakeTx);
    expect(data).toMatchObject({
      engagementId: 'engagement-1',
      currency: 'ARS',
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
      amount: 500,
      commissionPercentApplied: 10,
    });
  });

  it('rounds a non-dividing commission amount', async () => {
    const { service, createCashCommissionDebtEntry } = makeService({
      commissionPercentValue: '10',
    });

    await service.recordCommissionDebt(fakeTx, {
      ...baseParams,
      quotedPrice: 3333,
    });

    const [, data] = createCashCommissionDebtEntry.mock.calls[0] as [
      unknown,
      CashCommissionDebtEntryData,
    ];
    // amount = round(3333 * 10 / 100) = round(333.3) = 333
    expect(data.amount).toBe(333);
  });

  it('throws LEDGER_COMMISSION_MISCONFIGURED and writes nothing when getValue returns null', async () => {
    const { service, createCashCommissionDebtEntry } = makeService({
      commissionPercentValue: null,
    });

    await expect(
      service.recordCommissionDebt(fakeTx, baseParams),
    ).rejects.toMatchObject({ code: 'LEDGER_COMMISSION_MISCONFIGURED' });
    expect(createCashCommissionDebtEntry).not.toHaveBeenCalled();
  });

  it('throws LEDGER_COMMISSION_MISCONFIGURED and writes nothing when the stored value is unparseable', async () => {
    const { service, createCashCommissionDebtEntry } = makeService({
      commissionPercentValue: 'not-a-number',
    });

    await expect(
      service.recordCommissionDebt(fakeTx, baseParams),
    ).rejects.toMatchObject({ code: 'LEDGER_COMMISSION_MISCONFIGURED' });
    expect(createCashCommissionDebtEntry).not.toHaveBeenCalled();
  });
});
