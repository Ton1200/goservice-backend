import { PrismaService } from '../prisma/prisma.service';
import { CashPaymentRepository } from './cash-payment.repository';

describe('CashPaymentRepository', () => {
  function makeRepository() {
    const upsert = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const fakeTx = {
      cashPaymentConfirmation: { upsert, updateMany },
    } as never;
    const repository = new CashPaymentRepository({} as PrismaService);
    return { repository, fakeTx, upsert, updateMany };
  }

  interface UpsertConfirmationArgs {
    where: { engagementId: string };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }

  describe('upsertConfirmation', () => {
    it('stamps customerConfirmedAt only for CUSTOMER', async () => {
      const { repository, fakeTx, upsert } = makeRepository();

      await repository.upsertConfirmation(fakeTx, 'engagement-1', 'CUSTOMER');

      const [call] = upsert.mock.calls[0] as [UpsertConfirmationArgs];
      expect(call.where).toEqual({ engagementId: 'engagement-1' });
      expect(Object.keys(call.update)).toEqual(['customerConfirmedAt']);
      expect(call.update.customerConfirmedAt).toBeInstanceOf(Date);
      expect(call.create.engagementId).toBe('engagement-1');
      expect(call.create.customerConfirmedAt).toBeInstanceOf(Date);
    });

    it('stamps professionalConfirmedAt only for PROFESSIONAL, never touching the customer column', async () => {
      const { repository, fakeTx, upsert } = makeRepository();

      await repository.upsertConfirmation(
        fakeTx,
        'engagement-1',
        'PROFESSIONAL',
      );

      const [call] = upsert.mock.calls[0] as [UpsertConfirmationArgs];
      expect(call.update).not.toHaveProperty('customerConfirmedAt');
      expect(call.create).not.toHaveProperty('customerConfirmedAt');
      expect(call.update.professionalConfirmedAt).toBeInstanceOf(Date);
    });
  });

  describe('markCommissionDebtRecordedIfUnset', () => {
    it('guards the update with commissionDebtRecorded: false', async () => {
      const { repository, fakeTx, updateMany } = makeRepository();

      const result = await repository.markCommissionDebtRecordedIfUnset(
        fakeTx,
        'engagement-1',
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { engagementId: 'engagement-1', commissionDebtRecorded: false },
        data: { commissionDebtRecorded: true },
      });
      expect(result).toEqual({ count: 1 });
    });
  });
});
