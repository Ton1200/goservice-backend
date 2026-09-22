import { PaymentAttemptType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderSavedCard } from './ports/payment-provider.port';
import { SavedCardRepository } from './saved-card.repository';

const CARD: ProviderSavedCard = {
  providerCardId: 'card_1',
  brand: 'visa',
  lastFour: '1111',
  type: 'credit_card',
  expirationMonth: 12,
  expirationYear: 2030,
};

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('SavedCardRepository', () => {
  describe('createProviderCustomer', () => {
    const data = {
      customerProfileId: 'profile-1',
      method: PaymentMethod.RAPYD,
      environment: 'sandbox',
      providerCustomerId: 'cus_loser',
    };

    it('stores the link', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'link-1' });
      const repository = new SavedCardRepository({
        paymentProviderCustomer: { create },
      } as unknown as PrismaService);

      await expect(repository.createProviderCustomer(data)).resolves.toEqual({
        id: 'link-1',
      });
      expect(create).toHaveBeenCalledWith({ data });
    });

    it("two concurrent first saves race on the unique key: the loser gets the WINNER's row back instead of failing", async () => {
      const winner = { id: 'link-1', providerCustomerId: 'cus_winner' };
      const findUnique = jest.fn().mockResolvedValue(winner);
      const repository = new SavedCardRepository({
        paymentProviderCustomer: {
          create: jest.fn().mockRejectedValue(p2002()),
          findUnique,
        },
      } as unknown as PrismaService);

      await expect(repository.createProviderCustomer(data)).resolves.toBe(
        winner,
      );
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          customerProfileId_method_environment: {
            customerProfileId: 'profile-1',
            method: PaymentMethod.RAPYD,
            environment: 'sandbox',
          },
        },
      });
    });

    it('any other failure propagates', async () => {
      const repository = new SavedCardRepository({
        paymentProviderCustomer: {
          create: jest.fn().mockRejectedValue(new Error('db down')),
        },
      } as unknown as PrismaService);

      await expect(repository.createProviderCustomer(data)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('syncCards', () => {
    function makeRepository() {
      const upsert = jest.fn().mockResolvedValue({});
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const findMany = jest.fn().mockResolvedValue([{ id: 'saved-1' }]);
      const tx = { savedPaymentCard: { upsert, deleteMany, findMany } };
      const transaction = jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      );
      const repository = new SavedCardRepository({
        $transaction: transaction,
      } as unknown as PrismaService);
      return { repository, upsert, deleteMany, findMany, transaction };
    }

    it('upserts what Rapyd lists (non-sensitive facts only, type mapped to the enum), removes what it no longer lists, in ONE transaction', async () => {
      const m = makeRepository();

      const result = await m.repository.syncCards(
        'profile-1',
        PaymentMethod.RAPYD,
        'sandbox',
        [CARD],
      );

      expect(m.transaction).toHaveBeenCalledTimes(1);
      expect(m.upsert).toHaveBeenCalledWith({
        where: {
          method_environment_providerCardId: {
            method: PaymentMethod.RAPYD,
            environment: 'sandbox',
            providerCardId: 'card_1',
          },
        },
        create: {
          customerProfileId: 'profile-1',
          method: PaymentMethod.RAPYD,
          environment: 'sandbox',
          providerCardId: 'card_1',
          brand: 'visa',
          lastFour: '1111',
          type: PaymentAttemptType.CREDIT_CARD,
          expirationMonth: 12,
          expirationYear: 2030,
        },
        // A token stays with the Customer it was first synced for.
        update: {
          brand: 'visa',
          lastFour: '1111',
          type: PaymentAttemptType.CREDIT_CARD,
          expirationMonth: 12,
          expirationYear: 2030,
        },
      });
      expect(m.deleteMany).toHaveBeenCalledWith({
        where: {
          customerProfileId: 'profile-1',
          method: PaymentMethod.RAPYD,
          environment: 'sandbox',
          providerCardId: { notIn: ['card_1'] },
        },
      });
      expect(result).toEqual([{ id: 'saved-1' }]);
    });

    it('an EMPTY vault removes every local card of that customer/environment', async () => {
      const m = makeRepository();

      await m.repository.syncCards(
        'profile-1',
        PaymentMethod.RAPYD,
        'sandbox',
        [],
      );

      expect(m.upsert).not.toHaveBeenCalled();
      expect(m.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          customerProfileId: 'profile-1',
          providerCardId: { notIn: [] },
        }) as unknown,
      });
    });

    it('a card type the provider does not report is stored as null, never guessed', async () => {
      const m = makeRepository();

      await m.repository.syncCards(
        'profile-1',
        PaymentMethod.RAPYD,
        'sandbox',
        [{ ...CARD, type: null }],
      );

      expect(m.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ type: null }) as unknown,
        }),
      );
    });
  });

  describe('findCardOfCustomer', () => {
    it('only ever matches a card of THAT customer profile (ownership is part of the query)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const repository = new SavedCardRepository({
        savedPaymentCard: { findFirst },
      } as unknown as PrismaService);

      await repository.findCardOfCustomer('saved-1', 'profile-1');

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'saved-1', customerProfileId: 'profile-1' },
      });
    });
  });
});
