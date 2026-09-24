import { LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerRepository } from './ledger.repository';

/**
 * Direct unit coverage for `findManyForCallerProfiles`'s OR-clause building
 * (2026-09-14 follow-up) — every other method on this repository is a
 * straight Prisma pass-through already covered indirectly through its
 * owning service's own spec, but this one has real conditional logic
 * (0/1/2 ids) worth testing directly.
 */
describe('LedgerRepository.findManyForCallerProfiles', () => {
  function makeRepository() {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { ledgerEntry: { findMany } } as unknown as PrismaService;
    const repository = new LedgerRepository(prisma);
    return { repository, findMany };
  }

  it('queries by customerProfileId OR professionalProfileId when both are given', async () => {
    const { repository, findMany } = makeRepository();

    await repository.findManyForCallerProfiles({
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { customerProfileId: 'customer-1' },
          { professionalProfileId: 'professional-1' },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('queries by customerProfileId only when the caller has no ProfessionalProfile', async () => {
    const { repository, findMany } = makeRepository();

    await repository.findManyForCallerProfiles({
      customerProfileId: 'customer-1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { OR: [{ customerProfileId: 'customer-1' }] },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns an empty list WITHOUT querying the database when the caller has neither profile type', async () => {
    const { repository, findMany } = makeRepository();

    const result = await repository.findManyForCallerProfiles({});

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

/**
 * GOS-130 follow-up — regression coverage for a real bug a live e2e run
 * surfaced: Prisma evaluates a column's `@default(now())` CLIENT-SIDE, per
 * statement, NOT as a Postgres `now()`/`CURRENT_TIMESTAMP` default shared
 * for the whole transaction — so 3 sequential `tx.ledgerEntry.create()`
 * calls relying on the default got 3 DIFFERENT `createdAt` values, a few
 * milliseconds apart, silently breaking every downstream "these rows are
 * one financial event" grouping that keyed off `createdAt` equality
 * (`groupIntoEvents`/`selectMostRecentLedgerEventRows`). The fix is an
 * explicit, shared `createdAt` passed to all 3 creates — this test locks
 * that in directly against the real `tx.ledgerEntry.create` call arguments,
 * so a future refactor can't silently drop it back to the (broken) default.
 */
describe('LedgerRepository.createCustomerCancellationChargeEntries', () => {
  function makeTx() {
    const create = jest
      .fn()
      .mockImplementation(({ data }: Prisma.LedgerEntryCreateArgs) => data);
    const tx = {
      ledgerEntry: { create },
    } as unknown as Prisma.TransactionClient;
    return { tx, create };
  }

  it('passes the exact same createdAt Date instance to all 3 creates', async () => {
    const prisma = {} as unknown as PrismaService;
    const repository = new LedgerRepository(prisma);
    const { tx, create } = makeTx();

    await repository.createCustomerCancellationChargeEntries(tx, {
      engagementId: 'engagement-1',
      currency: 'ARS',
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
      feeAmount: 500,
      commissionAmount: 50,
      netAmount: 450,
      commissionPercentApplied: 10,
    });

    expect(create).toHaveBeenCalledTimes(3);
    const calls = create.mock.calls as [Prisma.LedgerEntryCreateArgs][];
    const createdAts = calls.map(([{ data }]) => data.createdAt);
    expect(createdAts[0]).toBeInstanceOf(Date);
    // Same instance on all 3 calls, not just an equal value by coincidence.
    expect(createdAts[1]).toBe(createdAts[0]);
    expect(createdAts[2]).toBe(createdAts[0]);

    const types = calls.map(([{ data }]) => data.type);
    expect(types).toEqual([
      'CUSTOMER_CANCELLATION_FEE',
      'PLATFORM_COMMISSION',
      'PROFESSIONAL_NET_CREDIT',
    ]);
    const amounts = calls.map(([{ data }]) => data.amount);
    expect(amounts).toEqual([-500, 50, 450]);
  });
});

/**
 * GOS-85 — `createDigitalPaymentEntries`, the writer of the 3-row card-payment
 * event. Same two invariants as `createCustomerCancellationChargeEntries`
 * above, locked in against the real `tx.ledgerEntry.create` arguments: ONE
 * shared `createdAt` (see that method's own header comment) and a zero-sum
 * signed shape.
 */
describe('LedgerRepository.createDigitalPaymentEntries', () => {
  function makeTx() {
    const create = jest
      .fn()
      .mockImplementation(({ data }: Prisma.LedgerEntryCreateArgs) => data);
    const tx = {
      ledgerEntry: { create },
    } as unknown as Prisma.TransactionClient;
    return { tx, create };
  }

  const data = {
    engagementId: 'engagement-1',
    currency: 'COP',
    customerProfileId: 'customer-1',
    professionalProfileId: 'professional-1',
    chargeAmount: 50000,
    commissionAmount: 5000,
    netAmount: 45000,
    commissionPercentApplied: 10,
  };

  it('writes CUSTOMER_CHARGE (negative), PLATFORM_COMMISSION, PROFESSIONAL_NET_CREDIT in that order, summing to zero', async () => {
    const repository = new LedgerRepository({} as unknown as PrismaService);
    const { tx, create } = makeTx();

    const rows = await repository.createDigitalPaymentEntries(tx, data);

    expect(create).toHaveBeenCalledTimes(3);
    const [charge, commission, net] =
      rows as unknown as Prisma.LedgerEntryUncheckedCreateInput[];
    expect(charge).toMatchObject({ type: 'CUSTOMER_CHARGE', amount: -50000 });
    expect(commission).toMatchObject({
      type: 'PLATFORM_COMMISSION',
      amount: 5000,
    });
    expect(net).toMatchObject({
      type: 'PROFESSIONAL_NET_CREDIT',
      amount: 45000,
    });
    expect(charge.amount + commission.amount + net.amount).toBe(0);
    for (const row of [charge, commission, net]) {
      expect(row).toMatchObject({
        engagementId: 'engagement-1',
        currency: 'COP',
        customerProfileId: 'customer-1',
        professionalProfileId: 'professional-1',
        commissionPercentApplied: 10,
      });
    }
  });

  it('passes the exact same createdAt Date instance to all 3 creates', async () => {
    const repository = new LedgerRepository({} as unknown as PrismaService);
    const { tx, create } = makeTx();

    await repository.createDigitalPaymentEntries(tx, data);

    const createdAts = create.mock.calls.map(
      ([args]: [Prisma.LedgerEntryCreateArgs]) =>
        (args.data as { createdAt: Date }).createdAt,
    );
    expect(createdAts[0]).toBeInstanceOf(Date);
    expect(createdAts[1]).toBe(createdAts[0]);
    expect(createdAts[2]).toBe(createdAts[0]);
  });
});

describe('LedgerRepository.sumProfessionalBalancesByCurrency', () => {
  function makeRepository(
    groups: Array<{
      type: LedgerEntryType;
      currency: string;
      _sum: { amount: number | null };
    }>,
  ) {
    const groupBy = jest.fn().mockResolvedValue(groups);
    const prisma = { ledgerEntry: { groupBy } } as unknown as PrismaService;
    return { repository: new LedgerRepository(prisma), groupBy };
  }

  it('subtracts cash commission debt from net credits and reports the debt', async () => {
    const { repository, groupBy } = makeRepository([
      {
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        currency: 'ARS',
        _sum: { amount: 9000 },
      },
      {
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        currency: 'ARS',
        _sum: { amount: 1500 },
      },
    ]);

    await expect(
      repository.sumProfessionalBalancesByCurrency('professional-1'),
    ).resolves.toEqual([
      { currency: 'ARS', balance: 7500, pendingCashCommissionDebt: 1500 },
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['type', 'currency'],
      where: {
        professionalProfileId: 'professional-1',
        type: {
          in: [
            LedgerEntryType.PROFESSIONAL_NET_CREDIT,
            LedgerEntryType.CASH_COMMISSION_DEBT,
          ],
        },
      },
      _sum: { amount: true },
    });
  });

  it('goes negative when only cash commission debt exists', async () => {
    const { repository } = makeRepository([
      {
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        currency: 'COP',
        _sum: { amount: 12000 },
      },
    ]);

    await expect(
      repository.sumProfessionalBalancesByCurrency('professional-1'),
    ).resolves.toEqual([
      { currency: 'COP', balance: -12000, pendingCashCommissionDebt: 12000 },
    ]);
  });

  it('keeps each currency separate, sorted by currency', async () => {
    const { repository } = makeRepository([
      {
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        currency: 'COP',
        _sum: { amount: 50000 },
      },
      {
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        currency: 'ARS',
        _sum: { amount: 1000 },
      },
    ]);

    await expect(
      repository.sumProfessionalBalancesByCurrency('professional-1'),
    ).resolves.toEqual([
      { currency: 'ARS', balance: 1000, pendingCashCommissionDebt: 0 },
      { currency: 'COP', balance: 50000, pendingCashCommissionDebt: 0 },
    ]);
  });

  it('returns an empty array when the Professional has no rows', async () => {
    const { repository } = makeRepository([]);

    await expect(
      repository.sumProfessionalBalancesByCurrency('professional-1'),
    ).resolves.toEqual([]);
  });
});
