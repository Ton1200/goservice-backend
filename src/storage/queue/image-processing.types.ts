/**
 * GOS-70 — payload of a `process-image` job. Deliberately just the storage
 * key: the worker re-reads the parked bytes from staging, so nothing large
 * (or sensitive) travels through Redis.
 */
export interface ImageProcessingJobPayload {
  storageKey: string;
}
