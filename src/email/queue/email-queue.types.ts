export interface EmailJobPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Lets logs/metrics distinguish job types (e.g. `verification_code`,
   * later `password_reset`) without a schema change.
   */
  metadata?: { kind: string };
}
