import { Queue } from 'bullmq';
import { SEND_EMAIL_JOB_NAME } from './email-queue.constants';
import { EmailQueueService } from './email-queue.service';
import { EmailJobPayload } from './email-queue.types';

describe('EmailQueueService', () => {
  it('enqueues a job under the send-email job name with the given payload', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = { add } as unknown as Queue<EmailJobPayload>;
    const service = new EmailQueueService(queue);

    const payload: EmailJobPayload = {
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
      metadata: { kind: 'verification_code' },
    };
    await service.enqueueEmail(payload);

    expect(add).toHaveBeenCalledWith(SEND_EMAIL_JOB_NAME, payload);
  });
});
