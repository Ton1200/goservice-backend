import { Injectable } from '@nestjs/common';
import { PlatformSettingValueType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { STORAGE_SETTING_KEY_PREFIX } from '../../../storage/storage-setting-keys.constants';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { PlatformSettingsRepository } from '../platform-settings.repository';
import { CredentialEncryptionPort } from '../ports/credential-encryption.port';
import { SetPlatformSettingInput } from '../models/set-platform-setting.input';
import { PlatformSettingModel } from '../models/platform-setting.model';
import { toPlatformSettingModel } from '../models/to-platform-setting-model.util';
import {
  invalidPlatformSettingValue,
  platformSettingEncryptedCannotBePublic,
  platformSettingKeyReserved,
  platformSettingValueRequired,
} from '../errors/invalid-platform-setting-value.error';

/**
 * Orchestrates `setPlatformSetting`: validates BEFORE writing, encrypts the
 * plaintext `value` when `isEncrypted`, upserts the `PlatformSetting` row,
 * AND writes an `AdminAuditLog` row — all in the SAME `$transaction`,
 * mirroring `SetFeatureFlagService`/`SetPlatformCredentialService` (the two
 * Slice-1/2 services this one replaces) exactly. This service owns the
 * transaction boundary (injects `PrismaService` directly) because it spans
 * two tables each owned by a different repository (`PlatformSettingsRepository`,
 * `AuditLogRepository`).
 *
 * Validation order matters and is deliberate:
 *   1. `isEncrypted && isPublic` is rejected FIRST, unconditionally, before
 *      any DB read/write — a hard veto (see
 *      `platformSettingEncryptedCannotBePublic`'s own comment). This is
 *      defense in depth on top of the DB's own
 *      `platform_setting_encrypted_not_public_check` CHECK constraint (the
 *      real, unbypassable backstop), giving a clearer error message than a
 *      raw constraint violation.
 *   2. The "empty value on an update to an already-encrypted setting means
 *      don't change it" case is detected next (requires one `findByKey`
 *      read).
 *   3. Every OTHER case validates `value` actually parses for the declared
 *      `valueType` BEFORE any encryption/DB write is attempted.
 *
 * `isPublic` (GOS-3x follow-up #2, 2026-08-10) is back as its own
 * independent, default-OFF gate on `platformConfig` exposure — see
 * `PlatformSetting`'s own header comment in `prisma/schema.prisma`.
 */
@Injectable()
export class SetPlatformSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettingsRepository: PlatformSettingsRepository,
    private readonly credentialEncryptionPort: CredentialEncryptionPort,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async setPlatformSetting(
    adminUserId: string,
    input: SetPlatformSettingInput,
  ): Promise<PlatformSettingModel> {
    if (input.key.startsWith(STORAGE_SETTING_KEY_PREFIX)) {
      // GOS-70 — `storage.*` rows are owned by `updateStorageSettings`
      // (permission `STORAGE_SETTINGS_WRITE`), never this generic surface.
      throw platformSettingKeyReserved();
    }

    if (input.isEncrypted && input.isPublic) {
      throw platformSettingEncryptedCannotBePublic();
    }

    const existing = await this.platformSettingsRepository.findByKey(input.key);
    const isNoOpEncryptedUpdate =
      input.isEncrypted && input.value === '' && existing?.isEncrypted === true;

    if (!isNoOpEncryptedUpdate) {
      this.assertValueParses(input.value, input.valueType);
    }

    let value: string | null = null;
    let ciphertext: Uint8Array | null = null;
    let iv: Uint8Array | null = null;
    let authTag: Uint8Array | null = null;
    let maskedPreview: string | null = null;

    if (input.isEncrypted) {
      if (isNoOpEncryptedUpdate) {
        // "Don't change it" — reuse the already-stored ciphertext rather
        // than re-encrypting an empty string. `existing` is guaranteed
        // non-null and encrypted here (that's `isNoOpEncryptedUpdate`'s own
        // condition), so its encrypted columns are guaranteed non-null by
        // the DB CHECK constraint.
        ciphertext = existing.ciphertext;
        iv = existing.iv;
        authTag = existing.authTag;
        maskedPreview = existing.maskedPreview;
      } else {
        const encrypted = this.credentialEncryptionPort.encrypt(input.value);
        ciphertext = encrypted.ciphertext;
        iv = encrypted.iv;
        authTag = encrypted.authTag;
        maskedPreview = this.credentialEncryptionPort.maskedPreview(
          input.value,
        );
      }
    } else {
      value = input.value;
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await this.platformSettingsRepository.upsert(tx, {
        key: input.key,
        description: input.description,
        valueType: input.valueType,
        isEncrypted: input.isEncrypted,
        isPublic: input.isPublic,
        value,
        ciphertext,
        iv,
        authTag,
        maskedPreview,
        provider: input.provider ?? null,
        updatedByAdminUserId: adminUserId,
      });

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'PLATFORM_SETTING_SET',
        targetType: 'PlatformSetting',
        targetKey: input.key,
        // NEVER ciphertext/plaintext of an encrypted setting — only the
        // masked preview. A non-encrypted setting's value is not secret by
        // definition, so recording it as-is is safe (mirrors
        // `SetFeatureFlagService`'s `{ enabled }` metadata).
        metadata: input.isEncrypted ? { maskedPreview } : { value },
      });

      return toPlatformSettingModel(row);
    });
  }

  private assertValueParses(
    value: string,
    valueType: PlatformSettingValueType,
  ): void {
    if (value === '') {
      throw platformSettingValueRequired();
    }
    if (
      valueType === PlatformSettingValueType.BOOLEAN &&
      value !== 'true' &&
      value !== 'false'
    ) {
      throw invalidPlatformSettingValue(valueType);
    }
    if (
      valueType === PlatformSettingValueType.NUMBER &&
      !Number.isFinite(Number(value))
    ) {
      throw invalidPlatformSettingValue(valueType);
    }
  }
}
