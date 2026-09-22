import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { LedgerRepository } from '../ledger.repository';
import { RecordDigitalPaymentService } from './record-digital-payment.service';

interface DigitalEntriesData {
  engagementId: string;
  currency: string;
  customerProfileId: string;
  professionalProfileId: string;
  chargeAmount: number;
  commissionAmount: number;
  netAmount: number;
  commissionPercentApplied: number;
}

describe('RecordDigitalPaymentService', () => {
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
    const createDigitalPaymentEntries = jest
      .fn()
      .mockResolvedValue([{}, {}, {}]);
    const ledgerRepository = {
      createDigitalPaymentEntries,
    } as unknown as LedgerRepository;
    const service = new RecordDigitalPaymentService(
      platformSettingPort,
      ledgerRepository,
    );
    return { service, getValue, createDigitalPaymentEntries };
  }

  const baseParams = {
    engagementId: 'engagement-1',
    quotedPrice: 50000,
    currency: 'COP',
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
  };

  it('writes the full quoted price as the charge, split by computeCommission, with the commission percent frozen on the event', async () => {
    const { service, getValue, createDigitalPaymentEntries } = makeService();

    await service.recordDigitalPayment(fakeTx, baseParams);

    expect(getValue).toHaveBeenCalledWith(
      'payments.general-settings.commission.percent',
    );
    expect(createDigitalPaymentEntries).toHaveBeenCalledTimes(1);
    const [tx, data] = createDigitalPaymentEntries.mock.calls[0] as [
      unknown,
      DigitalEntriesData,
    ];
    expect(tx).toBe(fakeTx);
    expect(data).toEqual({
      engagementId: 'engagement-1',
      currency: 'COP',
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
      chargeAmount: 50000,
      commissionAmount: 5000,
      netAmount: 45000,
      commissionPercentApplied: 10,
    });
  });

  it.each([
    [3333, '10'],
    [1, '10'],
    [99999, '12'],
    [7, '33'],
  ])(
    'keeps the ledger zero-sum for a %i job at %s%% (net is a remainder, never independently rounded)',
    async (quotedPrice, percent) => {
      const { service, createDigitalPaymentEntries } = makeService({
        commissionPercentValue: percent,
      });

      await service.recordDigitalPayment(fakeTx, {
        ...baseParams,
        quotedPrice,
      });

      const [, data] = createDigitalPaymentEntries.mock.calls[0] as [
        unknown,
        DigitalEntriesData,
      ];
      expect(data.chargeAmount).toBe(quotedPrice);
      expect(-data.chargeAmount + data.commissionAmount + data.netAmount).toBe(
        0,
      );
    },
  );

  it('throws LEDGER_COMMISSION_MISCONFIGURED (with a payment-worded message) and writes nothing when the setting is missing', async () => {
    const { service, createDigitalPaymentEntries } = makeService({
      commissionPercentValue: null,
    });

    const promise = service.recordDigitalPayment(fakeTx, baseParams);

    await expect(promise).rejects.toMatchObject({
      code: 'LEDGER_COMMISSION_MISCONFIGURED',
    });
    await expect(promise).rejects.toThrow(/payment cannot be recorded/);
    expect(createDigitalPaymentEntries).not.toHaveBeenCalled();
  });

  it('throws LEDGER_COMMISSION_MISCONFIGURED and writes nothing when the stored value is unparseable', async () => {
    const { service, createDigitalPaymentEntries } = makeService({
      commissionPercentValue: 'not-a-number',
    });

    await expect(
      service.recordDigitalPayment(fakeTx, baseParams),
    ).rejects.toMatchObject({ code: 'LEDGER_COMMISSION_MISCONFIGURED' });
    expect(createDigitalPaymentEntries).not.toHaveBeenCalled();
  });
});
