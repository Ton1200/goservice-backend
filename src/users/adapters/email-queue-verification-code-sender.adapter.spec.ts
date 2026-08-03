import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { EmailJobPayload } from '../../email/queue/email-queue.types';
import { EmailQueueVerificationCodeSenderAdapter } from './email-queue-verification-code-sender.adapter';

describe('EmailQueueVerificationCodeSenderAdapter', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({ codeTtlMinutes: 15 }),
    } as unknown as ConfigService;
  }

  it('enqueues a verification_code email containing the code', async () => {
    const enqueueEmail = jest
      .fn<Promise<void>, [EmailJobPayload]>()
      .mockResolvedValue(undefined);
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;
    const adapter = new EmailQueueVerificationCodeSenderAdapter(
      emailQueueService,
      makeConfigService(),
    );

    await adapter.sendVerificationCode('jane@example.com', '123456');

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const [payload] = enqueueEmail.mock.calls[0];
    expect(payload.to).toBe('jane@example.com');
    expect(payload.metadata).toEqual({ kind: 'verification_code' });
    expect(payload.text).toContain('123456');
    expect(payload.html).toContain('123456');
  });
});
