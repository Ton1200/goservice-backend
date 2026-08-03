import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { EmailJobPayload } from '../../email/queue/email-queue.types';
import { EmailQueuePasswordResetEmailSenderAdapter } from './email-queue-password-reset-email-sender.adapter';

describe('EmailQueuePasswordResetEmailSenderAdapter', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({ codeTtlMinutes: 15 }),
    } as unknown as ConfigService;
  }

  it('enqueues a password_reset_code email containing the code', async () => {
    const enqueueEmail = jest
      .fn<Promise<void>, [EmailJobPayload]>()
      .mockResolvedValue(undefined);
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;
    const adapter = new EmailQueuePasswordResetEmailSenderAdapter(
      emailQueueService,
      makeConfigService(),
    );

    await adapter.sendPasswordResetCode('jane@example.com', '123456');

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const [payload] = enqueueEmail.mock.calls[0];
    expect(payload.to).toBe('jane@example.com');
    expect(payload.metadata).toEqual({ kind: 'password_reset_code' });
    expect(payload.text).toContain('123456');
    expect(payload.html).toContain('123456');
  });
});
