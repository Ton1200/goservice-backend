import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ResendEmailClientAdapter } from './adapters/resend-email-client.adapter';
import { EmailClientPort } from './ports/email-client.port';
import {
  EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
  EMAIL_QUEUE_NAME,
} from './queue/email-queue.constants';
import { EmailQueueProcessor } from './queue/email-queue.processor';
import { EmailQueueService } from './queue/email-queue.service';

/**
 * Shared email-sending infrastructure: a BullMQ queue backed by the
 * project's existing Redis instance (see `BullModule.forRootAsync` in
 * `app.module.ts` for the connection), a worker that delivers via Resend,
 * and `EmailQueueService` as the only seam other modules should depend on.
 * Intended to be reused by future email-sending features (e.g. GOS-9
 * forgot-password), not just verification codes.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
      defaultJobOptions: EMAIL_QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  providers: [
    { provide: EmailClientPort, useClass: ResendEmailClientAdapter },
    EmailQueueProcessor,
    EmailQueueService,
  ],
  exports: [EmailQueueService],
})
export class EmailModule {}
