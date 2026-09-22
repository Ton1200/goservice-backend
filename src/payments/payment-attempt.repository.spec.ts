import { PaymentAttemptStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentAttemptRepository } from './payment-attempt.repository';

describe('PaymentAttemptRepository', () => {
  function make() {
    const create = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue(null);
    const findFirst = jest.fn().mockResolvedValue(null);
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      paymentAttempt: {
        create,
        updateMany,
        findUnique,
        findFirst,
        count,
        findMany,
      },
    } as unknown as PrismaService;
    return {
      repository: new PaymentAttemptRepository(prisma),
      create,
      updateMany,
      findFirst,
      findUnique,
      count,
      findMany,
    };
  }

  it('createPending inserts a PENDING, MERCADOPAGO row — the only method it writes', async () => {
    const { repository, create } = make();

    await repository.createPending({
      engagementId: 'e1',
      amount: 50000,
      currency: 'COP',
      installments: 3,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        engagementId: 'e1',
        amount: 50000,
        currency: 'COP',
        installments: 3,
        method: PaymentMethod.MERCADOPAGO,
        status: PaymentAttemptStatus.PENDING,
      },
    });
  });

  describe('upsertCashConfirmation — the raw INSERT ... ON CONFLICT that makes cash idempotent', () => {
    it('returns the resulting row when the statement inserts or updates', async () => {
      const row = { id: 'a1', method: 'CASH', status: 'PENDING' };
      const $queryRaw = jest.fn().mockResolvedValue([row]);
      const tx = { $queryRaw } as never;
      const { repository } = make();

      const result = await repository.upsertCashConfirmation(tx, {
        engagementId: 'e1',
        amount: 50000,
        currency: 'COP',
        role: 'CUSTOMER',
      });

      expect(result).toBe(row);
      expect($queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns null when the WHERE method = CASH guard skips a conflicting NON-cash row (empty RETURNING) — the PAYMENT_METHOD_CONFLICT signal', async () => {
      const $queryRaw = jest.fn().mockResolvedValue([]);
      const tx = { $queryRaw } as never;
      const { repository } = make();

      const result = await repository.upsertCashConfirmation(tx, {
        engagementId: 'e1',
        amount: 50000,
        currency: 'COP',
        role: 'PROFESSIONAL',
      });

      expect(result).toBeNull();
    });
  });

  describe('resolveIfPending — the CAS that makes resolution idempotent, for every method', () => {
    it("only updates a row that is STILL PENDING, inside the caller's tx", async () => {
      const { repository } = make();
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = { paymentAttempt: { updateMany: txUpdateMany } } as never;

      const result = await repository.resolveIfPending(tx, 'a1', {
        status: 'APPROVED',
        providerPaymentId: 'ORD_1',
        rejectionReason: null,
      });

      expect(result).toEqual({ count: 1 });
      expect(txUpdateMany).toHaveBeenCalledWith({
        where: { id: 'a1', status: PaymentAttemptStatus.PENDING },
        data: {
          status: 'APPROVED',
          rejectionReason: null,
          providerPaymentId: 'ORD_1',
        },
      });
    });

    it('never blanks out an already-recorded providerPaymentId when none is supplied', async () => {
      const { repository } = make();
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = { paymentAttempt: { updateMany: txUpdateMany } } as never;

      await repository.resolveIfPending(tx, 'a1', {
        status: 'REJECTED',
        providerPaymentId: null,
        rejectionReason: 'OTHER',
      });

      const [{ data }] = txUpdateMany.mock.calls[0] as [{ data: object }];
      expect(data).toEqual({ status: 'REJECTED', rejectionReason: 'OTHER' });
      expect(data).not.toHaveProperty('providerPaymentId');
    });

    it('writes the non-sensitive payment details IN THE SAME statement as the status flip, deriving `type` from `paymentTypeId`', async () => {
      const { repository } = make();
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = { paymentAttempt: { updateMany: txUpdateMany } } as never;
      const approvedAt = new Date('2026-09-18T15:05:28.000Z');

      await repository.resolveIfPending(tx, 'a1', {
        status: 'APPROVED',
        providerPaymentId: 'ORD_1',
        rejectionReason: null,
        details: {
          paymentTypeId: 'credit_card',
          cardBrand: 'visa',
          cardLastFour: '6260',
          providerFeeAmount: 2912,
          providerTaxAmount: 957,
          netReceivedAmount: 46131,
          approvedAt,
          moneyReleaseAt: approvedAt,
        },
      });

      expect(txUpdateMany).toHaveBeenCalledTimes(1);
      const [{ where, data }] = txUpdateMany.mock.calls[0] as [
        { where: object; data: Record<string, unknown> },
      ];
      expect(where).toEqual({ id: 'a1', status: PaymentAttemptStatus.PENDING });
      expect(data).toEqual({
        status: 'APPROVED',
        rejectionReason: null,
        providerPaymentId: 'ORD_1',
        type: 'CREDIT_CARD',
        paymentTypeId: 'credit_card',
        cardBrand: 'visa',
        cardLastFour: '6260',
        providerFeeAmount: 2912,
        providerTaxAmount: 957,
        netReceivedAmount: 46131,
        providerApprovedAt: approvedAt,
        moneyReleaseAt: approvedAt,
      });
    });

    it.each([[undefined], [null]])(
      'writes NO detail columns when the details are %p (an approved payment whose record could not be read)',
      async (details) => {
        const { repository } = make();
        const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
        const tx = { paymentAttempt: { updateMany: txUpdateMany } } as never;

        await repository.resolveIfPending(tx, 'a1', {
          status: 'APPROVED',
          providerPaymentId: 'ORD_1',
          rejectionReason: null,
          details,
        });

        const [{ data }] = txUpdateMany.mock.calls[0] as [{ data: object }];
        expect(data).toEqual({
          status: 'APPROVED',
          rejectionReason: null,
          providerPaymentId: 'ORD_1',
        });
      },
    );
  });

  it('attachProviderPaymentIdIfPending only touches a PENDING attempt with no id yet', async () => {
    const { repository, updateMany } = make();

    await repository.attachProviderPaymentIdIfPending('a1', 'ORD_1');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'a1',
        status: PaymentAttemptStatus.PENDING,
        providerPaymentId: null,
      },
      data: { providerPaymentId: 'ORD_1' },
    });
  });

  it('findPendingWithoutProviderIdByEngagementId looks for the lost-response case only', async () => {
    const { repository, findFirst } = make();

    await repository.findPendingWithoutProviderIdByEngagementId('e1');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        engagementId: 'e1',
        status: PaymentAttemptStatus.PENDING,
        providerPaymentId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findByProviderPaymentId looks up by the provider id', async () => {
    const { repository, findFirst } = make();

    await repository.findByProviderPaymentId('ORD_1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { providerPaymentId: 'ORD_1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findCashAttemptByEngagementId looks up the cash row for that Engagement', async () => {
    const { repository, findFirst } = make();

    await repository.findCashAttemptByEngagementId('e1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { engagementId: 'e1', method: PaymentMethod.CASH },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findLatestByEngagementId looks up the most recent row, of ANY method or status (GOS-142)', async () => {
    const { repository, findFirst } = make();

    await repository.findLatestByEngagementId('e1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { engagementId: 'e1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findActiveByEngagementId looks up a PENDING or APPROVED row of ANY method', async () => {
    const { repository, findFirst } = make();

    await repository.findActiveByEngagementId('e1');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        engagementId: 'e1',
        status: {
          in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.APPROVED],
        },
      },
    });
  });

  describe('admin listing', () => {
    it('onlyPending filters to PENDING or REJECTED, whatever the method', async () => {
      const { repository, findMany } = make();

      await repository.findManyForAdmin({ onlyPending: true }, 50, 0);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          engagementId: undefined,
          status: {
            in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.REJECTED],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('with no filter, returns everything', async () => {
      const { repository, count } = make();

      await repository.countForAdmin();

      expect(count).toHaveBeenCalledWith({ where: {} });
    });
  });
});
