import { Logger } from '@nestjs/common';
import { StoragePort } from '../../../service-requests/ports/storage.port';
import { RequestEmailLogoUploadUrlService } from './request-email-logo-upload-url.service';

describe('RequestEmailLogoUploadUrlService', () => {
  const target = {
    uploadUrl: 'http://localhost:3000/uploads/abc?token=t&expires=1',
    publicUrl: 'http://localhost:3000/uploads/abc.png',
    expiresAt: new Date('2026-01-01T00:30:00.000Z'),
  };

  function makeService() {
    const createUploadUrl = jest.fn().mockResolvedValue(target);
    const storagePort = { createUploadUrl } as unknown as StoragePort;

    const service = new RequestEmailLogoUploadUrlService(storagePort);

    return { service, createUploadUrl };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to StoragePort and returns the EmailLogoUploadUrl shape', async () => {
    const { service, createUploadUrl } = makeService();

    const result = await service.requestUploadUrl({
      fileName: 'logo.png',
      contentType: 'image/png',
    });

    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'logo.png',
      contentType: 'image/png',
    });
    expect(result).toEqual({
      uploadUrl: target.uploadUrl,
      publicUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });
  });

  it.each(['image/jpeg', 'image/webp'])('accepts %s', async (contentType) => {
    const { service, createUploadUrl } = makeService();

    await service.requestUploadUrl({ fileName: 'logo', contentType });

    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'logo',
      contentType,
    });
  });

  it('throws UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE for a disallowed content type', async () => {
    const { service, createUploadUrl } = makeService();

    await expect(
      service.requestUploadUrl({
        fileName: 'file.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it('throws UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE for a completely unrelated content type', async () => {
    const { service, createUploadUrl } = makeService();

    await expect(
      service.requestUploadUrl({
        fileName: 'archive.zip',
        contentType: 'application/zip',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });
});
