import { Logger } from '@nestjs/common';
import { RequestUserProfilePhotoUploadUrlService } from './request-user-profile-photo-upload-url.service';

describe('RequestUserProfilePhotoUploadUrlService', () => {
  function makeService() {
    const target = {
      uploadUrl: 'http://localhost:3000/uploads/abc.webp?token=t&expires=1',
      publicUrl: 'http://localhost:3000/uploads/abc.webp',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const createUploadUrl = jest.fn().mockResolvedValue(target);
    const service = new RequestUserProfilePhotoUploadUrlService({
      createUploadUrl,
    });
    return { service, createUploadUrl, target };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('rejects a disallowed content type without calling storage', async () => {
    const { service, createUploadUrl } = makeService();
    await expect(
      service.requestUploadUrl({
        fileName: 'x.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it('delegates to StoragePort and returns the ref-less upload-url shape', async () => {
    const { service, createUploadUrl, target } = makeService();
    const result = await service.requestUploadUrl({
      fileName: 'p.heic',
      contentType: 'image/heic',
    });
    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'p.heic',
      contentType: 'image/heic',
    });
    expect(result).toEqual({
      uploadUrl: target.uploadUrl,
      publicUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });
  });
});
