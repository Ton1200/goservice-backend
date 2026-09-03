import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
      uploadsDir: join(tmpdir(), 'goservice-adapter-spec-unused'),
      ...overrides,
    }),
  } as unknown as ConfigService<AppConfig, true>;
  return new LocalDevStorageAdapter(configService);
}

describe('LocalDevStorageAdapter', () => {
  it('createUploadUrl normalizes any image content-type to a .webp key', async () => {
    const adapter = buildAdapter();

    for (const contentType of ['image/jpeg', 'image/png', 'image/heic']) {
      const target = await adapter.createUploadUrl({
        fileName: 'photo.bin',
        contentType,
      });
      expect(target.publicUrl).toMatch(
        /^http:\/\/localhost:3000\/uploads\/[a-f0-9]{32}\.webp$/,
      );
      const key = target.publicUrl.split('/uploads/')[1];
      expect(target.uploadUrl).toContain(`/uploads/${key}?token=`);

      const url = new URL(target.uploadUrl);
      const token = url.searchParams.get('token')!;
      const expires = Number(url.searchParams.get('expires'));
      expect(adapter.verifyUploadToken(key, expires, token)).toBe(true);
    }
  });

  it('createUploadUrl keeps a .pdf key for application/pdf', async () => {
    const adapter = buildAdapter();
    const target = await adapter.createUploadUrl({
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
    });
    expect(target.publicUrl).toMatch(
      /^http:\/\/localhost:3000\/uploads\/[a-f0-9]{32}\.pdf$/,
    );
  });

  it('getContentType maps .webp and .pdf, octet-stream otherwise', () => {
    const adapter = buildAdapter();
    expect(adapter.getContentType(`${'a'.repeat(32)}.webp`)).toBe('image/webp');
    expect(adapter.getContentType(`${'a'.repeat(32)}.pdf`)).toBe(
      'application/pdf',
    );
    expect(adapter.getContentType(`${'a'.repeat(32)}.bin`)).toBe(
      'application/octet-stream',
    );
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
      adapter.verifyUploadToken('0'.repeat(32) + '.webp', expires, token),
    ).toBe(false);
  });

  it('verifyUploadToken rejects an expired token even with a valid signature', async () => {
    const adapter = buildAdapter();
    const pastExpiry = Date.now() - 1_000;
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

  it('stages, then promotes to the public key and clears staging', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'goservice-storage-'));
    try {
      const adapter = buildAdapter({ uploadsDir: dir });
      const key = `${'a'.repeat(32)}.webp`;

      await adapter.writeStagingFile(key, Buffer.from('raw-bytes'));
      expect((await adapter.readStagingFile(key))?.toString()).toBe(
        'raw-bytes',
      );
      // The public key must NOT hold the raw original while staged.
      expect(await adapter.readFile(key)).toBeNull();

      await adapter.promoteStagingToFinal(key, Buffer.from('webp-bytes'));
      expect(readFileSync(join(dir, key)).toString()).toBe('webp-bytes');
      expect(await adapter.readStagingFile(key)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
