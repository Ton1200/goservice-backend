import { Logger } from '@nestjs/common';
import { MediaUploadRefIntendedUse } from '@prisma/client';
import { StoragePort } from '../../storage/ports/storage.port';
import { MediaUploadsRepository } from '../media-uploads.repository';
import { RequestMediaUploadUrlService } from './request-media-upload-url.service';

describe('RequestMediaUploadUrlService', () => {
  const target = {
    uploadUrl: 'http://localhost:3000/uploads/abc?token=t&expires=1',
    publicUrl: 'http://localhost:3000/uploads/abc',
    expiresAt: new Date('2026-01-01T00:30:00.000Z'),
  };

  function makeService() {
    const createUploadUrl = jest.fn().mockResolvedValue(target);
    const storagePort = { createUploadUrl } as unknown as StoragePort;

    const createRef = jest.fn().mockResolvedValue({
      id: 'ref-1',
      storageKey: 'abc',
      fileUrl: target.publicUrl,
      intendedUse: MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
      expiresAt: target.expiresAt,
      userId: 'user-1',
    });
    const mediaUploadsRepository = {
      createRef,
    } as unknown as MediaUploadsRepository;

    const service = new RequestMediaUploadUrlService(
      storagePort,
      mediaUploadsRepository,
    );

    return { service, createUploadUrl, createRef };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to StoragePort, persists a ref with the server-derived userId + intendedUse, and returns the DocumentUploadUrl shape', async () => {
    const { service, createUploadUrl, createRef } = makeService();

    const result = await service.requestUploadUrl('user-1', {
      intendedUse: MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    expect(createRef).toHaveBeenCalledWith({
      userId: 'user-1',
      storageKey: 'abc',
      fileUrl: target.publicUrl,
      intendedUse: MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
      expiresAt: target.expiresAt,
    });
    expect(result).toEqual({
      ref: 'ref-1',
      uploadUrl: target.uploadUrl,
      fileUrl: target.publicUrl,
      expiresAt: target.expiresAt,
    });
  });

  it('carries the requested intendedUse through unchanged for a message-image slot', async () => {
    const { service, createRef } = makeService();

    await service.requestUploadUrl('user-9', {
      intendedUse: MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
      fileName: 'site.heic',
      contentType: 'image/heic',
    });

    expect(createRef).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-9',
        intendedUse: MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
      }),
    );
  });

  it('throws UNSUPPORTED_MEDIA_CONTENT_TYPE for a disallowed content type (incl. application/pdf)', async () => {
    const { service, createUploadUrl } = makeService();

    await expect(
      service.requestUploadUrl('user-1', {
        intendedUse: MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });
});
