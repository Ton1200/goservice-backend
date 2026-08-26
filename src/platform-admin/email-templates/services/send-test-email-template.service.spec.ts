import { EnsureEmailDeliveryAvailableService } from '../../../email/services/ensure-email-delivery-available.service';
import { EmailTemplateRenderer } from '../../../email/templates/email-template-renderer.service';
import { EmailQueueService } from '../../../email/queue/email-queue.service';
import { EmailJobPayload } from '../../../email/queue/email-queue.types';
import { SendTestEmailTemplateService } from './send-test-email-template.service';

describe('SendTestEmailTemplateService', () => {
  // Shared header/footer follow-up (2026-08-25) — this service now delegates
  // ALL rendering (template body + shared layout) to `EmailTemplateRenderer`,
  // so this spec mocks `render()` directly rather than
  // `EmailTemplatesRepository`+`renderEmailTemplate` — the composition
  // itself (including `EMAIL_TEMPLATE_NOT_CONFIGURED`/
  // `EMAIL_LAYOUT_NOT_CONFIGURED` fail-closed behavior) is covered by
  // `email-template-renderer.service.spec.ts`; this spec stays focused on
  // `SendTestEmailTemplateService`'s OWN orchestration (delivery-availability
  // gate first, key validation, enqueue).
  function makeService(options?: {
    ensureAvailableRejects?: boolean;
    renderRejects?: Error;
  }) {
    const ensureAvailable = jest.fn().mockImplementation(() =>
      options?.ensureAvailableRejects
        ? Promise.reject(
            Object.assign(new Error('disabled'), {
              code: 'EMAIL_DELIVERY_DISABLED',
            }),
          )
        : Promise.resolve(undefined),
    );
    const ensureEmailDeliveryAvailable = {
      ensureAvailable,
    } as unknown as EnsureEmailDeliveryAvailableService;

    const render = jest
      .fn()
      .mockImplementation((_key: string, variables: Record<string, string>) =>
        options?.renderRejects !== undefined
          ? Promise.reject(options.renderRejects)
          : Promise.resolve({
              subject: 'Tu código',
              html: `<p>${variables.greeting} ${variables.code}</p>`,
              text: `${variables.greeting} ${variables.code}`,
            }),
      );
    const emailTemplateRenderer = {
      render,
    } as unknown as EmailTemplateRenderer;

    const enqueueEmail = jest
      .fn<Promise<void>, [EmailJobPayload]>()
      .mockResolvedValue(undefined);
    const emailQueueService = {
      enqueueEmail,
    } as unknown as EmailQueueService;

    const service = new SendTestEmailTemplateService(
      ensureEmailDeliveryAvailable,
      emailTemplateRenderer,
      emailQueueService,
    );

    return { service, ensureAvailable, render, enqueueEmail };
  }

  it('checks email-delivery availability FIRST and propagates its rejection', async () => {
    const { service, ensureAvailable, render } = makeService({
      ensureAvailableRejects: true,
    });

    await expect(
      service.sendTestEmailTemplate('verification_code', 'to@example.com'),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(ensureAvailable).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects a key that is not one of the 3 known email template keys', async () => {
    const { service } = makeService();

    await expect(
      service.sendTestEmailTemplate('not_a_real_key', 'to@example.com'),
    ).rejects.toMatchObject({ code: 'UNKNOWN_EMAIL_TEMPLATE_KEY' });
  });

  it('propagates EMAIL_TEMPLATE_NOT_CONFIGURED when EmailTemplateRenderer.render() rejects', async () => {
    const { service, enqueueEmail } = makeService({
      renderRejects: Object.assign(new Error('not configured'), {
        code: 'EMAIL_TEMPLATE_NOT_CONFIGURED',
      }),
    });

    await expect(
      service.sendTestEmailTemplate('verification_code', 'to@example.com'),
    ).rejects.toMatchObject({ code: 'EMAIL_TEMPLATE_NOT_CONFIGURED' });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('renders with the sample variables and enqueues a real email', async () => {
    const { service, enqueueEmail } = makeService();

    const result = await service.sendTestEmailTemplate(
      'verification_code',
      'to@example.com',
    );

    expect(result).toBe(true);
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    const [payload] = enqueueEmail.mock.calls[0];
    expect(payload.to).toBe('to@example.com');
    expect(payload.metadata).toEqual({ kind: 'admin_template_test' });
    expect(payload.html).toContain('123456');
  });
});
