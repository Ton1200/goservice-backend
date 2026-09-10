import { Job } from 'bullmq';
import { LocalDevStorageAdapter } from '../adapters/local-dev-storage.adapter';
import { ImageProcessor } from '../image/image-processor';
import { ImageProcessingProcessor } from './image-processing.processor';
import { ImageProcessingJobPayload } from './image-processing.types';

function buildJob(
  data: ImageProcessingJobPayload,
  attemptsMade = 0,
): Job<ImageProcessingJobPayload> {
  return {
    data,
    attemptsMade,
    opts: { attempts: 3 },
  } as Job<ImageProcessingJobPayload>;
}

describe('ImageProcessingProcessor', () => {
  let storageAdapter: jest.Mocked<
    Pick<LocalDevStorageAdapter, 'readStagingFile' | 'promoteStagingToFinal'>
  >;
  let imageProcessor: jest.Mocked<Pick<ImageProcessor, 'toWebp'>>;
  let processor: ImageProcessingProcessor;

  beforeEach(() => {
    storageAdapter = {
      readStagingFile: jest.fn(),
      promoteStagingToFinal: jest.fn().mockResolvedValue(undefined),
    };
    imageProcessor = { toWebp: jest.fn() };
    processor = new ImageProcessingProcessor(
      storageAdapter as unknown as LocalDevStorageAdapter,
      imageProcessor as unknown as ImageProcessor,
    );
  });

  it('processes the staged bytes and promotes the WebP result', async () => {
    storageAdapter.readStagingFile.mockResolvedValue(Buffer.from('raw'));
    imageProcessor.toWebp.mockResolvedValue(Buffer.from('webp'));

    await processor.process(buildJob({ storageKey: 'k.webp' }));

    expect(imageProcessor.toWebp).toHaveBeenCalledWith(Buffer.from('raw'));
    expect(storageAdapter.promoteStagingToFinal).toHaveBeenCalledWith(
      'k.webp',
      Buffer.from('webp'),
    );
  });

  it('is a no-op when the staging file is already gone (idempotent retry)', async () => {
    storageAdapter.readStagingFile.mockResolvedValue(null);

    await expect(
      processor.process(buildJob({ storageKey: 'k.webp' }, 1)),
    ).resolves.toBeUndefined();

    expect(imageProcessor.toWebp).not.toHaveBeenCalled();
    expect(storageAdapter.promoteStagingToFinal).not.toHaveBeenCalled();
  });

  it('lets a processing error propagate (BullMQ ret/fail handles it)', async () => {
    storageAdapter.readStagingFile.mockResolvedValue(Buffer.from('raw'));
    imageProcessor.toWebp.mockRejectedValue(new Error('decode failed'));

    await expect(
      processor.process(buildJob({ storageKey: 'k.webp' })),
    ).rejects.toThrow('decode failed');
    expect(storageAdapter.promoteStagingToFinal).not.toHaveBeenCalled();
  });

  it('onFailed logs exhausted_retries once attempts are spent', () => {
    const errorSpy = jest
      .spyOn(processor['logger'], 'error')
      .mockImplementation(() => undefined);

    processor.onFailed(
      buildJob({ storageKey: 'k.webp' }, 3),
      new Error('boom'),
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'exhausted_retries' }),
    );
  });
});
