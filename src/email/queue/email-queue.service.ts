import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE_NAME, SEND_EMAIL_JOB_NAME } from './email-queue.constants';
import { EmailJobPayload } from './email-queue.types';

/**
 * The only email-sending seam other modules should depend on. Enqueues a
 * job and returns — actual delivery happens asynchronously in
 * `EmailQueueProcessor`, so a slow/down email provider never blocks or
 * fails the caller's request.
 */
@Injectable()
export class EmailQueueService {
  constructor(
    @InjectQueue(EMAIL_QUEUE_NAME)
    private readonly queue: Queue<EmailJobPayload>,
  ) {}

  async enqueueEmail(payload: EmailJobPayload): Promise<void> {
    await this.queue.add(SEND_EMAIL_JOB_NAME, payload);
  }
}
