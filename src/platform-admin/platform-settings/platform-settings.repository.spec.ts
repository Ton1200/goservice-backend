import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSettingsRepository } from './platform-settings.repository';

/**
 * GOS-3x follow-up #2 (2026-08-10) — proves `findPublicSettings()`'s `WHERE`
 * clause actually gates on BOTH `isEncrypted: false` AND `isPublic: true`,
 * not `isEncrypted: false` alone. This is the regression guard for the real
 * behavior change this round introduces: before this change, a row with
 * `isEncrypted: false, isPublic: false` (the new, default-OFF shape for a
 * brand-new setting) WOULD have appeared in `platformConfig` — this test
 * would have failed against the pre-change `where: { isEncrypted: false }`
 * clause, since it asserts the exact `where` object passed to Prisma.
 *
 * Mocks `PrismaService` directly (no real DB) — this repository is a thin
 * Prisma wrapper with no other repository-level unit spec precedent in this
 * codebase (every other `PlatformSetting`-touching repository behavior is
 * instead covered by the e2e suites, e.g. `test/platform-config.e2e-spec.ts`
 * and `test/platform-setting-check-constraints.e2e-spec.ts`) — this spec is
 * deliberately narrow: it exists ONLY to pin the exact `where` clause
 * literal, which a live-DB e2e test can't directly assert on (it can only
 * assert on the resulting rows, which `test/platform-config.e2e-spec.ts`
 * also does, as the end-to-end complement to this unit-level proof).
 */
describe('PlatformSettingsRepository', () => {
  describe('findPublicSettings', () => {
    it('queries with BOTH isEncrypted: false AND isPublic: true — not isEncrypted alone', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = {
        platformSetting: { findMany },
      } as unknown as PrismaService;
      const repository = new PlatformSettingsRepository(prisma);

      await repository.findPublicSettings();

      expect(findMany).toHaveBeenCalledWith({
        where: { isEncrypted: false, isPublic: true },
        orderBy: { key: 'asc' },
      });
    });
  });
});
