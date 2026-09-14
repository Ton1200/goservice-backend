import { EngagementStatus } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { LedgerRepository } from '../ledger.repository';
import { RecordCustomerCancellationChargeService } from './record-customer-cancellation-charge.service';

interface ChargeEntriesData {
  engagementId: string;
  currency: string;
  customerProfileId: string;
  professionalProfileId: string;
  feeAmount: number;
  commissionAmount: number;
  netAmount: number;
  commissionPercentApplied: number;
}

describe('RecordCustomerCancellationChargeService', () => {
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

    const createCustomerCancellationChargeEntries = jest
      .fn()
      .mockResolvedValue([{}, {}, {}]);
    const ledgerRepository = {
      createCustomerCancellationChargeEntries,
    } as unknown as LedgerRepository;

    const service = new RecordCustomerCancellationChargeService(
      platformSettingPort,
      ledgerRepository,
    );

    return { service, getValue, createCustomerCancellationChargeEntries };
  }

  const baseParams = {
    engagementId: 'engagement-1',
    quotedPrice: 5000,
    currency: 'ARS',
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
  };

  it('is a no-op (zero writes) when preCancelStatus is ACCEPTED', async () => {
    const { service, getValue, createCustomerCancellationChargeEntries } =
      makeService();

    await service.recordIfApplicable(fakeTx, {
      ...baseParams,
      preCancelStatus: EngagementStatus.ACCEPTED,
    });

    expect(getValue).not.toHaveBeenCalled();
    expect(createCustomerCancellationChargeEntries).not.toHaveBeenCalled();
  });

  it('writes exactly 3 entries with correct signs, zero-sum, and a frozen commissionPercentApplied when preCancelStatus is IN_PROGRESS', async () => {
    const { service, createCustomerCancellationChargeEntries } = makeService({
      commissionPercentValue: '10',
    });

    await service.recordIfApplicable(fakeTx, {
      ...baseParams,
      preCancelStatus: EngagementStatus.IN_PROGRESS,
    });

    expect(createCustomerCancellationChargeEntries).toHaveBeenCalledTimes(1);
    const [tx, data] = createCustomerCancellationChargeEntries.mock
      .calls[0] as [unknown, ChargeEntriesData];
    expect(tx).toBe(fakeTx);
    expect(data).toMatchObject({
      engagementId: 'engagement-1',
      currency: 'ARS',
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
      feeAmount: 500,
      commissionAmount: 50,
      netAmount: 450,
      commissionPercentApplied: 10,
    });
    // Zero-sum invariant: -fee + commission + net === 0.
    expect(-data.feeAmount + data.commissionAmount + data.netAmount).toBe(0);
  });

  it('rounds a non-dividing fee amount while preserving the zero-sum invariant', async () => {
    const { service, createCustomerCancellationChargeEntries } = makeService({
      commissionPercentValue: '10',
    });

    await service.recordIfApplicable(fakeTx, {
      ...baseParams,
      quotedPrice: 3333,
      preCancelStatus: EngagementStatus.IN_PROGRESS,
    });

    const [, data] = createCustomerCancellationChargeEntries.mock.calls[0] as [
      unknown,
      ChargeEntriesData,
    ];
    // feeAmount = round(3333 * 10 / 100) = round(333.3) = 333
    expect(data.feeAmount).toBe(333);
    expect(-data.feeAmount + data.commissionAmount + data.netAmount).toBe(0);
  });

  it('throws LEDGER_COMMISSION_MISCONFIGURED and writes nothing when getValue returns null', async () => {
    const { service, createCustomerCancellationChargeEntries } = makeService({
      commissionPercentValue: null,
    });

    await expect(
      service.recordIfApplicable(fakeTx, {
        ...baseParams,
        preCancelStatus: EngagementStatus.IN_PROGRESS,
      }),
    ).rejects.toMatchObject({ code: 'LEDGER_COMMISSION_MISCONFIGURED' });
    expect(createCustomerCancellationChargeEntries).not.toHaveBeenCalled();
  });

  it('throws LEDGER_COMMISSION_MISCONFIGURED and writes nothing when the stored value is unparseable', async () => {
    const { service, createCustomerCancellationChargeEntries } = makeService({
      commissionPercentValue: 'not-a-number',
    });

    await expect(
      service.recordIfApplicable(fakeTx, {
        ...baseParams,
        preCancelStatus: EngagementStatus.IN_PROGRESS,
      }),
    ).rejects.toMatchObject({ code: 'LEDGER_COMMISSION_MISCONFIGURED' });
    expect(createCustomerCancellationChargeEntries).not.toHaveBeenCalled();
  });
});
