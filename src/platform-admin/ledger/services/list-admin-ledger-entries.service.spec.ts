import { LedgerEntryType } from '@prisma/client';
import { LedgerRepository } from '../../../ledger/ledger.repository';
import { ListAdminLedgerEntriesService } from './list-admin-ledger-entries.service';

describe('ListAdminLedgerEntriesService', () => {
  const row = {
    id: 'ledger-entry-1',
    type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
    amount: -500,
    currency: 'ARS',
    engagementId: 'engagement-1',
    customerProfileId: 'customer-profile-1',
    professionalProfileId: 'professional-profile-1',
    commissionPercentApplied: 10,
    createdAt: new Date(),
  };

  function makeService() {
    const findManyForAdmin = jest.fn().mockResolvedValue([row]);
    const countForAdmin = jest.fn().mockResolvedValue(1);
    const ledgerRepository = {
      findManyForAdmin,
      countForAdmin,
    } as unknown as LedgerRepository;

    const service = new ListAdminLedgerEntriesService(ledgerRepository);
    return { service, findManyForAdmin, countForAdmin };
  }

  it('maps rows into AdminLedgerEntryModel shape', async () => {
    const { service } = makeService();

    const page = await service.listLedgerEntries();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'ledger-entry-1',
      type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
      amount: -500,
      currency: 'ARS',
      commissionPercentApplied: 10,
    });
    expect(page.totalCount).toBe(1);
  });

  it('passes the filter through to the repository unchanged', async () => {
    const { service, findManyForAdmin, countForAdmin } = makeService();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');

    await service.listLedgerEntries(
      {
        engagementId: 'engagement-1',
        professionalProfileId: undefined,
        from,
        to,
      },
      10,
      5,
    );

    expect(findManyForAdmin).toHaveBeenCalledWith(
      {
        engagementId: 'engagement-1',
        professionalProfileId: undefined,
        from,
        to,
      },
      10,
      5,
    );
    expect(countForAdmin).toHaveBeenCalledWith({
      engagementId: 'engagement-1',
      professionalProfileId: undefined,
      from,
      to,
    });
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listLedgerEntries(undefined, 9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 200, 0);
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listLedgerEntries();

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 50, 0);
  });
});
