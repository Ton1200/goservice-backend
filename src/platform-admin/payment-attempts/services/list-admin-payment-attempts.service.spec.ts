import { PaymentAttemptRepository } from '../../../payments/payment-attempt.repository';
import { ListAdminPaymentAttemptsService } from './list-admin-payment-attempts.service';

describe('ListAdminPaymentAttemptsService', () => {
  const cashRow = {
    id: 'attempt-1',
    engagementId: 'engagement-1',
    method: 'CASH',
    type: 'CASH',
    status: 'PENDING',
    amount: 8000,
    currency: 'ARS',
    installments: 1,
    rejectionReason: null,
    providerPaymentId: null,
    cardBrand: null,
    cardLastFour: null,
    providerFeeAmount: null,
    providerTaxAmount: null,
    netReceivedAmount: null,
    customerConfirmedAt: new Date(),
    professionalConfirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const cardRow = {
    ...cashRow,
    id: 'attempt-2',
    method: 'MERCADOPAGO',
    type: 'CREDIT_CARD',
    status: 'REJECTED',
    rejectionReason: 'INSUFFICIENT_FUNDS',
    providerPaymentId: 'ORD_1',
    cardBrand: 'visa',
    cardLastFour: '6260',
    customerConfirmedAt: null,
  };

  function makeService(rows = [cashRow, cardRow]) {
    const findManyForAdmin = jest.fn().mockResolvedValue(rows);
    const countForAdmin = jest.fn().mockResolvedValue(rows.length);
    const paymentAttemptRepository = {
      findManyForAdmin,
      countForAdmin,
    } as unknown as PaymentAttemptRepository;

    const service = new ListAdminPaymentAttemptsService(
      paymentAttemptRepository,
    );
    return { service, findManyForAdmin, countForAdmin };
  }

  it('maps rows into AdminPaymentAttemptModel shape, covering both a cash and a digital attempt', async () => {
    const { service } = makeService();

    const page = await service.listPaymentAttempts();

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      id: 'attempt-1',
      method: 'CASH',
      type: 'CASH',
      status: 'PENDING',
      professionalConfirmedAt: null,
    });
    expect(page.items[0].customerConfirmedAt).toBeInstanceOf(Date);
    expect(page.items[1]).toMatchObject({
      id: 'attempt-2',
      method: 'MERCADOPAGO',
      type: 'CREDIT_CARD',
      status: 'REJECTED',
      rejectionReason: 'INSUFFICIENT_FUNDS',
      providerPaymentId: 'ORD_1',
      cardBrand: 'visa',
      cardLastFour: '6260',
    });
    expect(page.totalCount).toBe(2);
  });

  it('passes engagementId/onlyPending through to the repository unchanged', async () => {
    const { service, findManyForAdmin, countForAdmin } = makeService();

    await service.listPaymentAttempts(
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

    await service.listPaymentAttempts(undefined, 9999, -5);

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 200, 0);
  });

  it('applies the default limit when none is given', async () => {
    const { service, findManyForAdmin } = makeService();

    await service.listPaymentAttempts();

    expect(findManyForAdmin).toHaveBeenCalledWith(undefined, 50, 0);
  });
});
