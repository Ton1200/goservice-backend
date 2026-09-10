import { Logger } from '@nestjs/common';
import { StoragePort } from '../../storage/ports/storage.port';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { RequestServiceRequestAttachmentUploadUrlService } from './request-service-request-attachment-upload-url.service';

describe('RequestServiceRequestAttachmentUploadUrlService', () => {
  const target = {
    uploadUrl: 'http://localhost:3000/uploads/abc?token=t&expires=1',
    publicUrl: 'http://localhost:3000/uploads/abc',
    expiresAt: new Date('2026-01-01T00:30:00.000Z'),
  };

  function makeService() {
    const createUploadUrl = jest.fn().mockResolvedValue(target);
    const storagePort = { createUploadUrl } as unknown as StoragePort;

    const createUploadRef = jest
      .fn()
      .mockResolvedValue({ id: 'ref-1', ...target, userId: 'user-1' });
    const serviceRequestsRepository = {
      createUploadRef,
    } as unknown as ServiceRequestsRepository;

    const service = new RequestServiceRequestAttachmentUploadUrlService(
      storagePort,
      serviceRequestsRepository,
    );

    return { service, createUploadUrl, createUploadRef };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('delegates to StoragePort, persists a ref, and returns the DocumentUploadUrl shape', async () => {
    const { service, createUploadUrl, createUploadRef } = makeService();

    const result = await service.requestUploadUrl('user-1', {
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(createUploadUrl).toHaveBeenCalledWith({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    expect(createUploadRef).toHaveBeenCalledWith({
      userId: 'user-1',
      storageKey: 'abc',
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

  it('throws UNSUPPORTED_ATTACHMENT_CONTENT_TYPE for a disallowed content type', async () => {
    const { service, createUploadUrl } = makeService();

    await expect(
      service.requestUploadUrl('user-1', {
        fileName: 'archive.zip',
        contentType: 'application/zip',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ATTACHMENT_CONTENT_TYPE' });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });
});
