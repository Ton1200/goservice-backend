import { CredentialEncryptionPort } from '../ports/credential-encryption.port';
import { PlatformSettingsRepository } from '../platform-settings.repository';
import { PrismaPlatformSettingAdapter } from './prisma-platform-setting.adapter';

describe('PrismaPlatformSettingAdapter', () => {
  function makeAdapter(findByKeyResult: unknown) {
    const findByKey = jest.fn().mockResolvedValue(findByKeyResult);
    const platformSettingsRepository = {
      findByKey,
    } as unknown as PlatformSettingsRepository;

    const decrypt = jest.fn().mockReturnValue('the-decrypted-value');
    const credentialEncryptionPort = {
      decrypt,
    } as unknown as CredentialEncryptionPort;

    const adapter = new PrismaPlatformSettingAdapter(
      platformSettingsRepository,
      credentialEncryptionPort,
    );

    return { adapter, findByKey, decrypt };
  }

  describe('getValue', () => {
    it('returns null for a missing row', async () => {
      const { adapter } = makeAdapter(null);

      await expect(adapter.getValue('missing.key')).resolves.toBeNull();
    });

    it('returns the plain, stored value AS-IS for a non-encrypted row — no decryption attempted', async () => {
      const { adapter, decrypt } = makeAdapter({
        isEncrypted: false,
        value: 'a-public-client-id',
        ciphertext: null,
        iv: null,
        authTag: null,
      });

      await expect(
        adapter.getValue('customer.social-login.google.client-id'),
      ).resolves.toBe('a-public-client-id');
      expect(decrypt).not.toHaveBeenCalled();
    });

    it('decrypts and returns the plaintext for an encrypted row', async () => {
      const ciphertext = Buffer.from('cipher');
      const iv = Buffer.from('iv');
      const authTag = Buffer.from('tag');
      const { adapter, decrypt } = makeAdapter({
        isEncrypted: true,
        value: null,
        ciphertext,
        iv,
        authTag,
      });

      await expect(
        adapter.getValue('customer.social-login.google.client-id'),
      ).resolves.toBe('the-decrypted-value');
      expect(decrypt).toHaveBeenCalledWith({ ciphertext, iv, authTag });
    });
  });
});
