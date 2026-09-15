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
