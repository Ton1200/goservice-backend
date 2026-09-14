import { LedgerRepository } from '../ledger.repository';
import { RecordProfessionalCancellationRefundService } from './record-professional-cancellation-refund.service';

describe('RecordProfessionalCancellationRefundService', () => {
  const fakeTx = { __fakeTransactionClient: true } as never;

  function makeService() {
    const createRefundEntry = jest.fn().mockResolvedValue({});
    const ledgerRepository = {
      createRefundEntry,
    } as unknown as LedgerRepository;

    const service = new RecordProfessionalCancellationRefundService(
      ledgerRepository,
    );

    return { service, createRefundEntry };
  }

  it('always writes exactly one positive REFUND row for the full quoted price', async () => {
    const { service, createRefundEntry } = makeService();

    await service.record(fakeTx, {
      engagementId: 'engagement-1',
      quotedPrice: 5000,
      currency: 'ARS',
      customerProfileId: 'customer-1',
    });

    expect(createRefundEntry).toHaveBeenCalledTimes(1);
    expect(createRefundEntry).toHaveBeenCalledWith(fakeTx, {
      engagementId: 'engagement-1',
      currency: 'ARS',
      customerProfileId: 'customer-1',
      amount: 5000,
    });
  });

  it('never calls PlatformSettingPort / computeCommission — this is a plain refund, not a split', () => {
    // No PlatformSettingPort is even injected into this service's
    // constructor — this test documents that fact structurally: the
    // service only has one dependency.
    const { service } = makeService();
    expect(service['ledgerRepository']).toBeDefined();
    expect(Object.keys(service as unknown as Record<string, unknown>)).toEqual([
      'ledgerRepository',
    ]);
  });
});
