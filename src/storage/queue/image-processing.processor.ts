import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LocalDevStorageAdapter } from '../adapters/local-dev-storage.adapter';
import { ImageProcessor } from '../image/image-processor';
import { IMAGE_PROCESSING_QUEUE_NAME } from './image-processing.constants';
import { ImageProcessingJobPayload } from './image-processing.types';

/**
 * GOS-70 — resizes + re-encodes a parked upload to WebP and promotes it to
 * the public key. Idempotent: if the staging file is already gone (a
 * duplicate or late retry after a successful promote), it's a logged no-op.
 * Mirrors `EmailQueueProcessor`.
 *
 * Depends on the CONCRETE `LocalDevStorageAdapter` (not `StoragePort`) for
 * the staging helpers — the same reason `UploadsController` does. When a
 * real object-storage adapter replaces `LocalDevStorageAdapter`, this
 * whole queue goes with it (a real provider does its own transforms).
 */
@Processor(IMAGE_PROCESSING_QUEUE_NAME)
export class ImageProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessingProcessor.name);

  constructor(
    private readonly storageAdapter: LocalDevStorageAdapter,
    private readonly imageProcessor: ImageProcessor,
  ) {
    super();
  }

  async process(job: Job<ImageProcessingJobPayload>): Promise<void> {
    const { storageKey } = job.data;
    const original = await this.storageAdapter.readStagingFile(storageKey);
    if (!original) {
      this.logger.log({
        event: 'image_processing_job',
        outcome: 'skipped_no_staging',
        attempt: job.attemptsMade + 1,
      });
      return;
    }

    const webp = await this.imageProcessor.toWebp(original);
    await this.storageAdapter.promoteStagingToFinal(storageKey, webp);

    this.logger.log({
      event: 'image_processing_job',
      outcome: 'success',
      attempt: job.attemptsMade + 1,
      inputBytes: original.length,
      outputBytes: webp.length,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(
    job: Job<ImageProcessingJobPayload> | undefined,
    error: Error,
  ): void {
    const exhausted = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error({
      event: 'image_processing_job_failed',
      // Exhausted retries => the staged original stays on disk and the
      // public key stays 404. No dead-letter/alerting exists yet (same as
      // the email queue) — TBD.
      outcome: exhausted ? 'exhausted_retries' : 'will_retry',
      attempt: job?.attemptsMade,
      error: error.message,
    });
  }
}
