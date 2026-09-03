import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { PlatformSettingsRepository } from '../platform-settings.repository';
import { CredentialEncryptionPort } from '../ports/credential-encryption.port';
import { SetPlatformSettingService } from './set-platform-setting.service';

describe('SetPlatformSettingService', () => {
  function makeService(existingRow: unknown = null) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByKey = jest.fn().mockResolvedValue(existingRow);
    const upsert = jest.fn().mockImplementation((_tx, data) =>
      Promise.resolve({
        id: 'setting-1',
        ...data,
        updatedByAdminUser: { displayName: 'Jane Admin' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );
    const platformSettingsRepository = {
      findByKey,
      upsert,
    } as unknown as PlatformSettingsRepository;

    const encrypt = jest.fn().mockReturnValue({
      ciphertext: Buffer.from('cipher'),
      iv: Buffer.from('iv'),
      authTag: Buffer.from('tag'),
    });
    const maskedPreview = jest.fn().mockReturnValue('•••9999');
    const credentialEncryptionPort = {
      encrypt,
      maskedPreview,
    } as unknown as CredentialEncryptionPort;

    // Explicitly typed args (not a bare `jest.fn()`) so `write.mock.calls`
    // below isn't `any[][]` — indexing an `any` value is exactly the kind
    // of thing `@typescript-eslint/no-unsafe-member-access` exists to catch.
    const write = jest
      .fn<Promise<{ id: string }>, [unknown, { metadata: unknown }]>()
      .mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new SetPlatformSettingService(
      prisma,
      platformSettingsRepository,
      credentialEncryptionPort,
      auditLogRepository,
    );

    return {
      service,
      $transaction,
      findByKey,
      upsert,
      write,
      encrypt,
      maskedPreview,
      fakeTx,
    };
  }

  it('upserts a non-encrypted setting and writes an AdminAuditLog row with the plain value, inside the SAME $transaction', async () => {
    const { service, upsert, write, fakeTx, $transaction } = makeService();

    const result = await service.setPlatformSetting('admin-1', {
      key: 'customer.social-login.google.enabled',
      description: 'Gates Google sign-in.',
      valueType: 'BOOLEAN',
      isEncrypted: false,
      isPublic: true,
      value: 'true',
    });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        key: 'customer.social-login.google.enabled',
        isEncrypted: false,
        isPublic: true,
        value: 'true',
        ciphertext: null,
        iv: null,
        authTag: null,
        maskedPreview: null,
      }),
    );
    expect(write).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        action: 'PLATFORM_SETTING_SET',
        targetType: 'PlatformSetting',
        targetKey: 'customer.social-login.google.enabled',
        metadata: { value: 'true' },
      }),
    );
    expect(result.rawValue).toBe('true');
    expect(result.isEncrypted).toBe(false);
  });

  it('encrypts the value for an encrypted setting, and the AdminAuditLog metadata contains ONLY the masked preview, never plaintext/ciphertext', async () => {
    const { service, upsert, write, encrypt, maskedPreview, fakeTx } =
      makeService();

    await service.setPlatformSetting('admin-1', {
      key: 'customer.social-login.google.client-id',
      description: 'Google client-id.',
      valueType: 'STRING',
      isEncrypted: true,
      isPublic: false,
      provider: 'GOOGLE',
      value: 'the-real-secret-value',
    });

    expect(encrypt).toHaveBeenCalledWith('the-real-secret-value');
    expect(maskedPreview).toHaveBeenCalledWith('the-real-secret-value');
    expect(upsert).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        isEncrypted: true,
        isPublic: false,
        value: null,
        maskedPreview: '•••9999',
      }),
    );
    const auditCall = write.mock.calls[0][1];
    expect(JSON.stringify(auditCall.metadata)).not.toContain(
      'the-real-secret-value',
    );
    expect(auditCall.metadata).toEqual({ maskedPreview: '•••9999' });
  });

  it('rejects an empty value for a fresh (never-before-configured) encrypted setting', async () => {
    const { service, upsert } = makeService(null);

    await expect(
      service.setPlatformSetting('admin-1', {
        key: 'customer.social-login.google.client-id',
        description: 'x',
        valueType: 'STRING',
        isEncrypted: true,
        isPublic: false,
        value: '',
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_SETTING_VALUE_REQUIRED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('treats an empty value as a no-op "don\'t change it" ONLY when updating an already-encrypted existing row, reusing its stored ciphertext', async () => {
    const existingRow = {
      key: 'customer.social-login.google.client-id',
      isEncrypted: true,
      ciphertext: Buffer.from('existing-cipher'),
      iv: Buffer.from('existing-iv'),
      authTag: Buffer.from('existing-tag'),
      maskedPreview: '•••1234',
    };
    const { service, upsert, encrypt, fakeTx } = makeService(existingRow);

    await service.setPlatformSetting('admin-1', {
      key: 'customer.social-login.google.client-id',
      description: 'updated description only',
      valueType: 'STRING',
      isEncrypted: true,
      isPublic: false,
      provider: 'GOOGLE',
      value: '',
    });

    expect(encrypt).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        ciphertext: existingRow.ciphertext,
        iv: existingRow.iv,
        authTag: existingRow.authTag,
        maskedPreview: '•••1234',
      }),
    );
  });

  it('rejects a reserved storage.* key (GOS-70) with PLATFORM_SETTING_KEY_RESERVED, before any DB read/write', async () => {
    const { service, findByKey, upsert } = makeService();

    await expect(
      service.setPlatformSetting('admin-1', {
        key: 'storage.image-processing.max-dimension-px',
        description: 'x',
        valueType: 'NUMBER',
        isEncrypted: false,
        isPublic: false,
        value: '1024',
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_SETTING_KEY_RESERVED' });
    expect(findByKey).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a BOOLEAN value that is not exactly "true"/"false"', async () => {
    const { service } = makeService();

    await expect(
      service.setPlatformSetting('admin-1', {
        key: 'x.y.z',
        description: 'x',
        valueType: 'BOOLEAN',
        isEncrypted: false,
        isPublic: false,
        value: 'yes',
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_SETTING_INVALID_VALUE' });
  });

  it('rejects a NUMBER value that does not parse as a finite number', async () => {
    const { service } = makeService();

    await expect(
      service.setPlatformSetting('admin-1', {
        key: 'x.y.z',
        description: 'x',
        valueType: 'NUMBER',
        isEncrypted: false,
        isPublic: false,
        value: 'not-a-number',
      }),
    ).rejects.toMatchObject({ code: 'PLATFORM_SETTING_INVALID_VALUE' });
  });

  it('rejects isEncrypted:true combined with isPublic:true BEFORE any DB read/write — a hard veto', async () => {
    const { service, findByKey, upsert } = makeService();

    await expect(
      service.setPlatformSetting('admin-1', {
        key: 'customer.social-login.google.client-id',
        description: 'x',
        valueType: 'STRING',
        isEncrypted: true,
        isPublic: true,
        value: 'irrelevant',
      }),
    ).rejects.toMatchObject({
      code: 'PLATFORM_SETTING_ENCRYPTED_CANNOT_BE_PUBLIC',
    });
    expect(findByKey).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accepts every OTHER isEncrypted/isPublic combination (false/false, false/true, true/false)', async () => {
    const combinations: { isEncrypted: boolean; isPublic: boolean }[] = [
      { isEncrypted: false, isPublic: false },
      { isEncrypted: false, isPublic: true },
      { isEncrypted: true, isPublic: false },
    ];

    for (const { isEncrypted, isPublic } of combinations) {
      const { service, upsert } = makeService();

      await service.setPlatformSetting('admin-1', {
        key: 'some.setting.key',
        description: 'x',
        valueType: isEncrypted ? 'STRING' : 'BOOLEAN',
        isEncrypted,
        isPublic,
        provider: isEncrypted ? 'GOOGLE' : undefined,
        value: isEncrypted ? 'a-secret-value' : 'true',
      });

      expect(upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isEncrypted, isPublic }),
      );
    }
  });
});
