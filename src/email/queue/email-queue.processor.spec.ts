import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailClientPort } from '../ports/email-client.port';
import { EmailQueueProcessor } from './email-queue.processor';
import { EmailJobPayload } from './email-queue.types';

describe('EmailQueueProcessor', () => {
  function makeJob(
    overrides: Partial<EmailJobPayload> = {},
    attemptsMade = 0,
  ): Job<EmailJobPayload> {
    return {
      data: {
        to: 'user@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
        metadata: { kind: 'verification_code' },
        ...overrides,
      },
      attemptsMade,
      opts: { attempts: 5 },
    } as unknown as Job<EmailJobPayload>;
  }

  it('calls the email client with the job payload fields', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const emailClient = { send } as unknown as EmailClientPort;
    const processor = new EmailQueueProcessor(emailClient);

    await processor.process(makeJob());

    expect(send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
    });
  });

  it('propagates a rejected send() so BullMQ can retry the job', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    const emailClient = { send } as unknown as EmailClientPort;
    const processor = new EmailQueueProcessor(emailClient);

    await expect(processor.process(makeJob())).rejects.toThrow('boom');
  });

  it('logs exhausted_retries once attemptsMade reaches the configured attempts', () => {
    const emailClient = { send: jest.fn() } as unknown as EmailClientPort;
    const processor = new EmailQueueProcessor(emailClient);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    processor.onFailed(makeJob({}, 5), new Error('exhausted'));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'exhausted_retries' }),
    );
    errorSpy.mockRestore();
  });

  it('logs will_retry when attempts remain', () => {
    const emailClient = { send: jest.fn() } as unknown as EmailClientPort;
    const processor = new EmailQueueProcessor(emailClient);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    processor.onFailed(makeJob({}, 2), new Error('transient'));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'will_retry' }),
    );
    errorSpy.mockRestore();
  });
});
