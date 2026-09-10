import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  IMAGE_PROCESSING_QUEUE_NAME,
  PROCESS_IMAGE_JOB_NAME,
} from './image-processing.constants';
import { ImageProcessingJobPayload } from './image-processing.types';

/**
 * GOS-70 — the seam `UploadsController` depends on to hand an uploaded
 * image off for async resize + WebP re-encode. Enqueues and returns; the
 * actual work happens in `ImageProcessingProcessor`, so a slow/large image
 * never blocks the PUT. Mirrors `EmailQueueService`.
 */
@Injectable()
export class ImageProcessingService {
  constructor(
    @InjectQueue(IMAGE_PROCESSING_QUEUE_NAME)
    private readonly queue: Queue<ImageProcessingJobPayload>,
  ) {}

  async enqueue(payload: ImageProcessingJobPayload): Promise<void> {
    await this.queue.add(PROCESS_IMAGE_JOB_NAME, payload);
  }
}
