import { ConfigService } from '@nestjs/config';
import { EmailTemplateRenderer } from '../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../email/queue/email-queue.service';
import { EmailJobPayload } from '../../email/queue/email-queue.types';
import { EmailQueueVerificationCodeSenderAdapter } from './email-queue-verification-code-sender.adapter';

describe('EmailQueueVerificationCodeSenderAdapter', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({ codeTtlMinutes: 15 }),
    } as unknown as ConfigService;
  }

  // Shared header/footer follow-up (2026-08-25) — this adapter now delegates
  // ALL rendering (template body + shared layout) to `EmailTemplateRenderer`,
  // so its own spec only needs to mock `render()`'s return value, not
  // `EmailTemplatePort`+`renderEmailTemplate` separately — the composition
  // itself is covered by `email-template-renderer.service.spec.ts`.
  function makeEmailTemplateRenderer(
    render: jest.Mock = jest
      .fn()
      .mockImplementation((_key: string, variables: Record<string, string>) =>
        Promise.resolve({
          subject: 'Tu código de verificación',
          html: `<p>${variables.greeting} Code: ${variables.code} (${variables.ttlMinutes}m)</p>`,
          text: `${variables.greeting} Code: ${variables.code} (${variables.ttlMinutes}m)`,
        }),
      ),
  ) {
    return {
      render,
    } as unknown as EmailTemplateRenderer;
  }

  it('enqueues a verification_code email containing the code and rendered greeting', async () => {
    const enqueueEmail = jest
      .fn<Promise<void>, [EmailJobPayload]>()
      .mockResolvedValue(undefined);
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;
    const adapter = new EmailQueueVerificationCodeSenderAdapter(
      emailQueueService,
      makeEmailTemplateRenderer(),
      makeConfigService(),
    );

    await adapter.sendVerificationCode('jane@example.com', '123456', 'Jane');

    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const [payload] = enqueueEmail.mock.calls[0];
    expect(payload.to).toBe('jane@example.com');
    expect(payload.metadata).toEqual({ kind: 'verification_code' });
    expect(payload.text).toContain('123456');
    expect(payload.html).toContain('123456');
    expect(payload.text).toContain('Hola Jane,');
  });

  it('resolves {{greeting}} to a generic "Hola," when firstName is null', async () => {
    const enqueueEmail = jest
      .fn<Promise<void>, [EmailJobPayload]>()
      .mockResolvedValue(undefined);
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;
    const adapter = new EmailQueueVerificationCodeSenderAdapter(
      emailQueueService,
      makeEmailTemplateRenderer(),
      makeConfigService(),
    );

    await adapter.sendVerificationCode('jane@example.com', '123456', null);

    const [payload] = enqueueEmail.mock.calls[0];
    expect(payload.text).toContain('Hola,');
  });

  it('throws EMAIL_TEMPLATE_NOT_CONFIGURED when EmailTemplateRenderer.render() rejects', async () => {
    const enqueueEmail = jest.fn();
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;
    const render = jest
      .fn()
      .mockRejectedValue({ code: 'EMAIL_TEMPLATE_NOT_CONFIGURED' });
    const adapter = new EmailQueueVerificationCodeSenderAdapter(
      emailQueueService,
      makeEmailTemplateRenderer(render),
      makeConfigService(),
    );

    await expect(
      adapter.sendVerificationCode('jane@example.com', '123456', 'Jane'),
    ).rejects.toMatchObject({ code: 'EMAIL_TEMPLATE_NOT_CONFIGURED' });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});
