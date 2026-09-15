import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EngagementsRepository } from './engagements.repository';

/**
 * Direct CAS test for `setPaymentMethodIfUnset` (GOS-87) — every other CAS
 * method on this repository (`startWorkIfAccepted`/`cancelIfActive`/etc.) is
 * only exercised indirectly through its owning service's own spec, but this
 * ticket's own AC explicitly calls for a direct test of the guard itself:
 * proves the `where` clause actually includes `paymentMethod: null` (the
 * physical guard against overwriting an already-assigned method), not just
 * that the method resolves.
 */
describe('EngagementsRepository.setPaymentMethodIfUnset', () => {
  function makeRepository(count: number) {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const fakeTx = { engagement: { updateMany } } as never;
    const repository = new EngagementsRepository({} as PrismaService);
    return { repository, fakeTx, updateMany };
  }

  it('guards the update with paymentMethod: null, and stamps the given method', async () => {
    const { repository, fakeTx, updateMany } = makeRepository(1);

    const result = await repository.setPaymentMethodIfUnset(
      fakeTx,
      'engagement-1',
      PaymentMethod.CASH,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'engagement-1', paymentMethod: null },
      data: { paymentMethod: PaymentMethod.CASH },
    });
    expect(result).toEqual({ count: 1 });
  });

  it('returns count: 0 (not an error) when a method is already assigned — the caller decides what count 0 means', async () => {
    const { repository, fakeTx } = makeRepository(0);

    const result = await repository.setPaymentMethodIfUnset(
      fakeTx,
      'engagement-1',
      PaymentMethod.CASH,
    );

    expect(result).toEqual({ count: 0 });
  });
});
