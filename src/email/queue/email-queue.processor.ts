import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailClientPort } from '../ports/email-client.port';
import { EMAIL_QUEUE_NAME } from './email-queue.constants';
import { EmailJobPayload } from './email-queue.types';

@Processor(EMAIL_QUEUE_NAME)
export class EmailQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private readonly emailClient: EmailClientPort) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<void> {
    await this.emailClient.send({
      to: job.data.to,
      subject: job.data.subject,
      text: job.data.text,
      html: job.data.html,
    });
    // Never log job.data.text/html (contains the plaintext code).
    this.logger.log({
      event: 'email_job_sent',
      outcome: 'success',
      kind: job.data.metadata?.kind,
      attempt: job.attemptsMade + 1,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJobPayload> | undefined, error: Error): void {
    const exhausted = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error({
      event: 'email_job_failed',
      outcome: exhausted ? 'exhausted_retries' : 'will_retry',
      kind: job?.data.metadata?.kind,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  }
}
