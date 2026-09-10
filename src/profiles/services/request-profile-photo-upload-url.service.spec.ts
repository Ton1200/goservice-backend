import { Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { StoragePort } from '../../storage/ports/storage.port';
import { ProfilesRepository } from '../profiles.repository';
import { RequestProfilePhotoUploadUrlService } from './request-profile-photo-upload-url.service';

describe('RequestProfilePhotoUploadUrlService', () => {
  function makeService(featureEnabled = true) {
    const target = {
      uploadUrl: 'http://localhost:3000/uploads/abc123.webp?token=t&expires=1',
      publicUrl: 'http://localhost:3000/uploads/abc123.webp',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const createUploadUrl = jest.fn().mockResolvedValue(target);
    const storagePort = { createUploadUrl } as unknown as StoragePort;

    const createProfilePhotoUploadRef = jest
      .fn()
      .mockResolvedValue({ id: 'ref-1' });
    const profilesRepository = {
      createProfilePhotoUploadRef,
    } as unknown as ProfilesRepository;

    const isEnabled = jest.fn().mockResolvedValue(featureEnabled);
    const platformSettingPort = {
      isEnabled,
      getValue: jest.fn(),
    } as unknown as PlatformSettingPort;

    const service = new RequestProfilePhotoUploadUrlService(
      storagePort,
      profilesRepository,
      platformSettingPort,
    );
    return {
      service,
      createUploadUrl,
      createProfilePhotoUploadRef,
      isEnabled,
      target,
    };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('rejects with PROFILE_PHOTO_UPLOAD_DISABLED when the feature is off, touching neither storage nor repo', async () => {
    const { service, createUploadUrl, createProfilePhotoUploadRef } =
      makeService(false);

    await expect(
      service.requestUploadUrl('user-1', {
        fileName: 'p.heic',
        contentType: 'image/heic',
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_PHOTO_UPLOAD_DISABLED' });
    expect(createUploadUrl).not.toHaveBeenCalled();
    expect(createProfilePhotoUploadRef).not.toHaveBeenCalled();
  });

  it('rejects a disallowed content type with UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE', async () => {
    const { service, createUploadUrl } = makeService();

    await expect(
      service.requestUploadUrl('user-1', {
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROFILE_PHOTO_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it('accepts HEIC, delegates to StoragePort, persists a ref, and returns the DocumentUploadUrl shape', async () => {
    const { service, createUploadUrl, createProfilePhotoUploadRef, target } =
      makeService();

    const result = await service.requestUploadUrl('user-1', {
      fileName: 'photo.heic',
      contentType: 'image/heic',
    });

    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'photo.heic',
      contentType: 'image/heic',
    });
    expect(createProfilePhotoUploadRef).toHaveBeenCalledWith({
      userId: 'user-1',
      storageKey: 'abc123.webp',
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });
    expect(result).toEqual({
      ref: 'ref-1',
      uploadUrl: target.uploadUrl,
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });
  });
});
