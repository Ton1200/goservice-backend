/**
 * Low-level abstraction over sending a single outbound email through
 * whatever provider is configured. Consumed only by
 * `EmailQueueProcessor` — application code should depend on
 * `EmailQueueService` instead (see `../queue/email-queue.service.ts`),
 * never on this port directly.
 */
export interface OutboundEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export abstract class EmailClientPort {
  abstract send(message: OutboundEmailMessage): Promise<void>;
}
