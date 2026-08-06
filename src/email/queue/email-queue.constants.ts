import type { DefaultJobOptions } from 'bullmq';

export const EMAIL_QUEUE_NAME = 'email';
export const SEND_EMAIL_JOB_NAME = 'send-email';

/**
 * Code constants, not env vars — these are implementation details with no
 * proven need for per-environment tuning yet.
 */
export const EMAIL_QUEUE_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: { age: 24 * 60 * 60 }, // keep 1 day, for debugging
  // Only manual visibility we have into failures (no admin UI/alerting
  // exists yet) — keep failed jobs a week so they can be inspected.
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};
