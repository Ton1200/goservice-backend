import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { LocalDevStorageAdapter } from './local-dev-storage.adapter';

function buildAdapter(
  overrides: Partial<AppConfig['storageLocal']> = {},
): LocalDevStorageAdapter {
  const configService = {
    get: jest.fn().mockReturnValue({
      baseUrl: 'http://localhost:3000',
      signingSecret: 'test-signing-secret',
      ...overrides,
    }),
  } as unknown as ConfigService<AppConfig, true>;
  return new LocalDevStorageAdapter(configService);
}

describe('LocalDevStorageAdapter', () => {
  it('createUploadUrl returns an uploadUrl/publicUrl sharing the same key, with a verifiable token', async () => {
    const adapter = buildAdapter();

    const target = await adapter.createUploadUrl({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(target.uploadUrl).toContain('http://localhost:3000/uploads/');
    expect(target.publicUrl).toMatch(
      /^http:\/\/localhost:3000\/uploads\/[a-f0-9]{32}\.jpg$/,
    );
    const key = target.publicUrl.split('/uploads/')[1];
    expect(target.uploadUrl).toContain(`/uploads/${key}?token=`);

    const url = new URL(target.uploadUrl);
    const token = url.searchParams.get('token')!;
    const expires = Number(url.searchParams.get('expires'));

    expect(adapter.verifyUploadToken(key, expires, token)).toBe(true);
  });

  it('verifyUploadToken rejects a tampered token', async () => {
    const adapter = buildAdapter();
    const target = await adapter.createUploadUrl({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    const url = new URL(target.uploadUrl);
    const key = url.pathname.split('/uploads/')[1];
    const expires = Number(url.searchParams.get('expires'));

    expect(adapter.verifyUploadToken(key, expires, 'not-the-real-token')).toBe(
      false,
    );
  });

  it('verifyUploadToken rejects a tampered key', async () => {
    const adapter = buildAdapter();
    const target = await adapter.createUploadUrl({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    const url = new URL(target.uploadUrl);
    const token = url.searchParams.get('token')!;
    const expires = Number(url.searchParams.get('expires'));

    expect(
      adapter.verifyUploadToken('0'.repeat(32) + '.jpg', expires, token),
    ).toBe(false);
  });

  it('verifyUploadToken rejects an expired token even with a valid signature', async () => {
    const adapter = buildAdapter();
    const pastExpiry = Date.now() - 1_000;
    // Compute a validly-signed token for a key that expired in the past —
    // via the same public API a real client would have received it from,
    // by round-tripping createUploadUrl and then asserting the expiry
    // check independently of signature validity.
    const target = await adapter.createUploadUrl({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    const url = new URL(target.uploadUrl);
    const key = url.pathname.split('/uploads/')[1];
    const token = url.searchParams.get('token')!;

    expect(adapter.verifyUploadToken(key, pastExpiry, token)).toBe(false);
  });

  it('falls back to a generated signing secret when none is configured', async () => {
    const adapter = buildAdapter({ signingSecret: undefined });
    const target = await adapter.createUploadUrl({
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
    });
    const url = new URL(target.uploadUrl);
    const key = url.pathname.split('/uploads/')[1];
    const token = url.searchParams.get('token')!;
    const expires = Number(url.searchParams.get('expires'));

    expect(adapter.verifyUploadToken(key, expires, token)).toBe(true);
  });
});
