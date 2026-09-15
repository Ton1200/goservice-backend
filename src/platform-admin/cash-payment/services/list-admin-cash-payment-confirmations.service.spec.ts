import { CashPaymentRepository } from '../../../cash-payment/cash-payment.repository';
import { ListAdminCashPaymentConfirmationsService } from './list-admin-cash-payment-confirmations.service';

describe('ListAdminCashPaymentConfirmationsService', () => {
  const row = {
    id: 'confirmation-1',
    engagementId: 'engagement-1',
    customerConfirmedAt: new Date(),
    professionalConfirmedAt: null,
    commissionDebtRecorded: false,
    createdAt: new Date(),
  };

  function makeService() {
    const findManyForAdmin = jest.fn().mockResolvedValue([row]);
    const countForAdmin = jest.fn().mockResolvedValue(1);
    const cashPaymentRepository = {
      findManyForAdmin,
      countForAdmin,
    } as unknown as CashPaymentRepository;

    const service = new ListAdminCashPaymentConfirmationsService(
      cashPaymentRepository,
    );
    return { service, findManyForAdmin, countForAdmin };
  }

  it('maps rows into AdminCashPaymentConfirmationModel shape, including a half-confirmed row', async () => {
    const { service } = makeService();

    const page = await service.listCashPaymentConfirmations();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'confirmation-1',
      engagementId: 'engagement-1',
      professionalConfirmedAt: null,
      commissionDebtRecorded: false,
    });
    expect(page.items[0].customerConfirmedAt).toBeInstanceOf(Date);
    expect(page.totalCount).toBe(1);
  });

  it('passes engagementId/onlyPending through to the repository unchanged', async () => {
    const { service, findManyForAdmin, countForAdmin } = makeService();

    await service.listCashPaymentConfirmations(
      { engagementId: 'engagement-1', onlyPending: true },
      10,
      5,
    );

    expect(findManyForAdmin).toHaveBeenCalledWith(
      { engagementId: 'engagement-1', onlyPending: true },
      10,
      5,
    );
    expect(countForAdmin).toHaveBeenCalledWith({
      engagementId: 'engagement-1',
      onlyPending: true,
    });
  });

  it('clamps limit to the server-enforced max and defaults offset to 0', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listCashPaymentConfirmations(undefined, 9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 200, 0);
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listCashPaymentConfirmations();

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 50, 0);
  });
});
