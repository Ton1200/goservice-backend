import { Injectable } from '@nestjs/common';
import {
  PlatformSetting,
  PlatformSettingValueType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PlatformSettingWithUpdatedBy = PlatformSetting & {
  updatedByAdminUser: { displayName: string } | null;
};

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `PlatformSetting` — same data-ownership rule as every other
 * `*Repository` in this codebase (see `FeatureFlagsRepository`/
 * `PlatformCredentialsRepository`, the two Slice-1/2 repositories this one
 * replaces, for the precedent).
 */
@Injectable()
export class PlatformSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * For the admin-facing `platformSettings` query — joins the updating
   * admin's `displayName` so `ListPlatformSettingsService` doesn't need a
   * second round trip.
   */
  findAllWithUpdatedBy(): Promise<PlatformSettingWithUpdatedBy[]> {
    return this.prisma.platformSetting.findMany({
      orderBy: { key: 'asc' },
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }

  /**
   * For `PlatformSettingPort` (`isEnabled`/`getValue`) and for
   * `SetPlatformSettingService`'s own pre-write lookup (to detect the
   * "empty value on an update to an already-encrypted setting means don't
   * change it" case). Returns the raw row, including `ciphertext`/`iv`/
   * `authTag` — callers that don't need those fields simply don't read
   * them; this codebase's convention (see `PlatformCredentialsRepository`,
   * the Slice-2 precedent) is to keep exactly one `findByKey`-shaped method
   * per repository rather than a narrower and a wider variant.
   */
  findByKey(key: string): Promise<PlatformSetting | null> {
    return this.prisma.platformSetting.findUnique({ where: { key } });
  }

  /**
   * For the UNAUTHENTICATED, consumer-facing `platformConfig` query
   * (`src/platform-admin/platform-settings/public/`). BOTH conditions are
   * now required (GOS-3x follow-up #2, 2026-08-10 — `isPublic` is back as
   * its own independent, default-OFF gate; see `PlatformSetting`'s own
   * header comment in `prisma/schema.prisma`): `isEncrypted: false` (not a
   * secret) AND `isPublic: true` (deliberately opted in to consumer
   * exposure). Never selects `ciphertext`/`iv`/`authTag`/`maskedPreview`.
   */
  findPublicSettings(): Promise<PlatformSetting[]> {
    return this.prisma.platformSetting.findMany({
      where: { isEncrypted: false, isPublic: true },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Runs INSIDE the caller's own `$transaction` (`SetPlatformSettingService`)
   * — same pattern as `FeatureFlagsRepository.upsert`/
   * `PlatformCredentialsRepository.upsert`: the setting write and the
   * `AdminAuditLog` write commit atomically or not at all.
   *
   * The `as Uint8Array<ArrayBuffer> | null` casts below are a narrowing,
   * NOT a behavior change — see `PlatformCredentialsRepository.upsert`'s own
   * comment (this codebase's Slice-2 precedent) for the exact reasoning:
   * Prisma's generated `Bytes`-column type (`Uint8Array<ArrayBuffer>`) is
   * narrower than `Buffer`'s own broader `Buffer<ArrayBufferLike>` generic.
   */
  upsert(
    tx: Prisma.TransactionClient,
    data: {
      key: string;
      description: string;
      valueType: PlatformSettingValueType;
      isEncrypted: boolean;
      isPublic: boolean;
      value: string | null;
      ciphertext: Uint8Array | null;
      iv: Uint8Array | null;
      authTag: Uint8Array | null;
      maskedPreview: string | null;
      provider: string | null;
      updatedByAdminUserId: string;
    },
  ): Promise<PlatformSettingWithUpdatedBy> {
    const shared = {
      description: data.description,
      valueType: data.valueType,
      isEncrypted: data.isEncrypted,
      isPublic: data.isPublic,
      value: data.value,
      ciphertext: data.ciphertext as Uint8Array<ArrayBuffer> | null,
      iv: data.iv as Uint8Array<ArrayBuffer> | null,
      authTag: data.authTag as Uint8Array<ArrayBuffer> | null,
      maskedPreview: data.maskedPreview,
      provider: data.provider,
      updatedByAdminUserId: data.updatedByAdminUserId,
    };

    return tx.platformSetting.upsert({
      where: { key: data.key },
      create: { key: data.key, ...shared },
      update: shared,
      include: { updatedByAdminUser: { select: { displayName: true } } },
    });
  }
}
