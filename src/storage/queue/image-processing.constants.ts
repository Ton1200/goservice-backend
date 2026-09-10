import type { DefaultJobOptions } from 'bullmq';

export const IMAGE_PROCESSING_QUEUE_NAME = 'image-processing';
export const PROCESS_IMAGE_JOB_NAME = 'process-image';

/**
 * Code constants, not env vars — same reasoning as `EMAIL_QUEUE_DEFAULT_JOB_OPTIONS`
 * (`src/email/queue/email-queue.constants.ts`): implementation details with
 * no proven need for per-environment tuning yet. Fewer attempts than the
 * email queue (3 vs 5): a job that can't decode/encode its bytes will fail
 * the same way every retry, so a long backoff ladder just delays the
 * inevitable.
 */
export const IMAGE_PROCESSING_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s
  removeOnComplete: { age: 24 * 60 * 60 }, // keep 1 day, for debugging
  // Only manual visibility into failures (no admin queue UI exists yet) —
  // keep failed jobs a week so the staged original + error can be inspected.
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};
