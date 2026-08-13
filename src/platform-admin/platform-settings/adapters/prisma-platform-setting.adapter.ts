import { Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../ports/platform-setting.port';
import { CredentialEncryptionPort } from '../ports/credential-encryption.port';
import { PlatformSettingsRepository } from '../platform-settings.repository';

/**
 * The only `PlatformSettingPort` implementation. Reuses
 * `PlatformSettingsRepository` (the sole owner of the `PlatformSetting`
 * table) rather than querying Prisma directly, so `PlatformSetting` still
 * has exactly one repository touching it.
 */
@Injectable()
export class PrismaPlatformSettingAdapter implements PlatformSettingPort {
  constructor(
    private readonly platformSettingsRepository: PlatformSettingsRepository,
    private readonly credentialEncryptionPort: CredentialEncryptionPort,
  ) {}

  async isEnabled(key: string): Promise<boolean> {
    const row = await this.platformSettingsRepository.findByKey(key);
    if (!row) {
      return true;
    }
    return row.value === 'true';
  }

  /**
   * Returns `row.value` as-is for a non-encrypted row, or decrypts
   * `row.ciphertext`/`iv`/`authTag` in memory for an encrypted one — the
   * caller neither knows nor cares which happened. Decryption (when it
   * happens) runs on every call, no plaintext caching, so a credential
   * rotated via `setPlatformSetting` takes effect on the very next call,
   * with no app restart. Returns `null` (not an error) only for a missing
   * key — see `PlatformSettingPort.getValue`'s doc comment for why the
   * fail-closed decision on a missing/misconfigured value belongs to the
   * CALLER, not this adapter.
   */
  async getValue(key: string): Promise<string | null> {
    const row = await this.platformSettingsRepository.findByKey(key);
    if (!row) {
      return null;
    }
    if (!row.isEncrypted) {
      return row.value;
    }
    // The DB CHECK constraint (`platform_setting_encrypted_shape_check`)
    // guarantees ciphertext/iv/authTag are non-null whenever isEncrypted is
    // true — the non-null assertions below reflect that guarantee, not an
    // unchecked assumption.
    return this.credentialEncryptionPort.decrypt({
      ciphertext: row.ciphertext!,
      iv: row.iv!,
      authTag: row.authTag!,
    });
  }
}
