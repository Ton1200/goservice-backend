import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanPlatformSettingsData, createTestApp } from './support/test-app';

/**
 * Proves the DB CHECK constraint added in
 * `prisma/migrations/20260808210000_consolidate_platform_settings/migration.sql`
 * (`platform_setting_encrypted_shape_check`) actually rejects an
 * inconsistent row at the database level — not just "should work" by
 * inspection. This is the load-bearing guardrail behind the accepted
 * trade-off documented on `PlatformSetting`'s own header comment in
 * `prisma/schema.prisma`: a per-row `isEncrypted` flag is weaker than a
 * structurally separate encrypted-only model UNLESS something makes the bad
 * shape physically impossible to persist — these tests are that proof,
 * exercised through `PrismaService` exactly the way application code would
 * (not raw SQL, so this also proves Prisma's generated `.create()` doesn't
 * quietly work around the constraint).
 *
 * `platform_setting_encrypted_not_public_check` (dropped along with
 * `isPublic` itself in `20260808220000_drop_platform_setting_is_public`) is
 * BACK, reintroduced by `20260810103000_reintroduce_platform_setting_is_public`
 * — see the dedicated describe block below for its own live-DB coverage,
 * proving Postgres itself rejects the `isEncrypted: true, isPublic: true`
 * combination directly, bypassing the service layer.
 */
describe('PlatformSetting DB CHECK constraints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const testKeys: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanPlatformSettingsData(prisma, testKeys);
    await app.close();
  });

  function key(suffix: string): string {
    const generated = `e2e-check-constraint-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testKeys.push(generated);
    return generated;
  }

  it('rejects an isEncrypted:true row missing its encrypted columns (platform_setting_encrypted_shape_check)', async () => {
    await expect(
      prisma.platformSetting.create({
        data: {
          key: key('encrypted-missing-cols'),
          description: 'bad row',
          valueType: 'STRING',
          isEncrypted: true,
          // No ciphertext/iv/authTag/maskedPreview at all.
        },
      }),
    ).rejects.toThrow(/platform_setting_encrypted_shape_check/);
  });

  it('rejects an isEncrypted:true row that ALSO carries a plaintext value (platform_setting_encrypted_shape_check)', async () => {
    await expect(
      prisma.platformSetting.create({
        data: {
          key: key('encrypted-with-plaintext'),
          description: 'bad row',
          valueType: 'STRING',
          isEncrypted: true,
          value: 'this-should-never-be-allowed-next-to-ciphertext',
          ciphertext: Buffer.from('c'),
          iv: Buffer.from('i'),
          authTag: Buffer.from('a'),
          maskedPreview: '••••',
        },
      }),
    ).rejects.toThrow(/platform_setting_encrypted_shape_check/);
  });

  it('rejects an isEncrypted:false row missing its plaintext value (platform_setting_encrypted_shape_check)', async () => {
    await expect(
      prisma.platformSetting.create({
        data: {
          key: key('plain-missing-value'),
          description: 'bad row',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          // No value at all.
        },
      }),
    ).rejects.toThrow(/platform_setting_encrypted_shape_check/);
  });

  it('rejects an isEncrypted:false row that carries leftover encrypted columns (platform_setting_encrypted_shape_check)', async () => {
    await expect(
      prisma.platformSetting.create({
        data: {
          key: key('plain-with-ciphertext'),
          description: 'bad row',
          valueType: 'STRING',
          isEncrypted: false,
          value: 'fine',
          ciphertext: Buffer.from('c'),
        },
      }),
    ).rejects.toThrow(/platform_setting_encrypted_shape_check/);
  });

  it('accepts a well-formed non-encrypted row', async () => {
    const goodKey = key('valid-plain');
    const row = await prisma.platformSetting.create({
      data: {
        key: goodKey,
        description: 'valid row',
        valueType: 'BOOLEAN',
        isEncrypted: false,
        value: 'true',
      },
    });
    expect(row.key).toBe(goodKey);
  });

  it('accepts a well-formed encrypted row', async () => {
    const goodKey = key('valid-encrypted');
    const row = await prisma.platformSetting.create({
      data: {
        key: goodKey,
        description: 'valid row',
        valueType: 'STRING',
        isEncrypted: true,
        ciphertext: Buffer.from('c'),
        iv: Buffer.from('i'),
        authTag: Buffer.from('a'),
        maskedPreview: '••••',
      },
    });
    expect(row.key).toBe(goodKey);
  });

  /**
   * GOS-3x follow-up #2 (2026-08-10) — `platform_setting_encrypted_not_public_check`
   * reintroduced by `20260810103000_reintroduce_platform_setting_is_public`.
   * Exercised the same way as every other constraint in this file: through
   * `PrismaService.create()`/`.update()` directly, bypassing
   * `SetPlatformSettingService` entirely, proving the DATABASE itself
   * rejects the invalid combination — not just the application-level
   * `platformSettingEncryptedCannotBePublic()` check, which is defense in
   * depth on top of this, not a substitute for it.
   */
  describe('platform_setting_encrypted_not_public_check', () => {
    it('rejects an isEncrypted:true row that is ALSO isPublic:true, on create', async () => {
      await expect(
        prisma.platformSetting.create({
          data: {
            key: key('encrypted-and-public'),
            description: 'bad row',
            valueType: 'STRING',
            isEncrypted: true,
            isPublic: true,
            ciphertext: Buffer.from('c'),
            iv: Buffer.from('i'),
            authTag: Buffer.from('a'),
            maskedPreview: '••••',
          },
        }),
      ).rejects.toThrow(/platform_setting_encrypted_not_public_check/);
    });

    it('rejects an isEncrypted:true row that is ALSO isPublic:true, on update (flipping an existing plain+public row)', async () => {
      const goodKey = key('flips-to-encrypted-and-public');
      await prisma.platformSetting.create({
        data: {
          key: goodKey,
          description: 'starts valid',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'true',
        },
      });

      await expect(
        prisma.platformSetting.update({
          where: { key: goodKey },
          data: {
            isEncrypted: true,
            isPublic: true,
            value: null,
            ciphertext: Buffer.from('c'),
            iv: Buffer.from('i'),
            authTag: Buffer.from('a'),
            maskedPreview: '••••',
          },
        }),
      ).rejects.toThrow(/platform_setting_encrypted_not_public_check/);
    });

    it('accepts isEncrypted:false with isPublic:true', async () => {
      const goodKey = key('valid-plain-public');
      const row = await prisma.platformSetting.create({
        data: {
          key: goodKey,
          description: 'valid row',
          valueType: 'BOOLEAN',
          isEncrypted: false,
          isPublic: true,
          value: 'true',
        },
      });
      expect(row.isPublic).toBe(true);
    });

    it('accepts isEncrypted:true with isPublic:false', async () => {
      const goodKey = key('valid-encrypted-non-public');
      const row = await prisma.platformSetting.create({
        data: {
          key: goodKey,
          description: 'valid row',
          valueType: 'STRING',
          isEncrypted: true,
          isPublic: false,
          ciphertext: Buffer.from('c'),
          iv: Buffer.from('i'),
          authTag: Buffer.from('a'),
          maskedPreview: '••••',
        },
      });
      expect(row.isPublic).toBe(false);
    });
  });
});
