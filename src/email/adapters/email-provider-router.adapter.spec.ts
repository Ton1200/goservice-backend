import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { EMAIL_PROVIDER_SETTING_KEY } from '../constants/email-provider-settings.constants';
import { EmailProviderRouterAdapter } from './email-provider-router.adapter';
import { MailpitEmailClientAdapter } from './mailpit-email-client.adapter';
import { ResendEmailClientAdapter } from './resend-email-client.adapter';

describe('EmailProviderRouterAdapter', () => {
  const message = {
    to: 'user@example.com',
    subject: 'Subject',
    text: 'Text',
    html: '<p>Text</p>',
  };
  const originalNodeEnv = process.env.NODE_ENV;

  function makeAdapter(providerValue: string | null) {
    const getValue = jest.fn((key: string) =>
      Promise.resolve(
        key === EMAIL_PROVIDER_SETTING_KEY ? providerValue : null,
      ),
    );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;
    const resendSend = jest.fn().mockResolvedValue(undefined);
    const mailpitSend = jest.fn().mockResolvedValue(undefined);
    const resendEmailClientAdapter = {
      send: resendSend,
    } as unknown as ResendEmailClientAdapter;
    const mailpitEmailClientAdapter = {
      send: mailpitSend,
    } as unknown as MailpitEmailClientAdapter;
    const adapter = new EmailProviderRouterAdapter(
      platformSettingPort,
      resendEmailClientAdapter,
      mailpitEmailClientAdapter,
    );
    return { adapter, resendSend, mailpitSend };
  }

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('delegates to Resend when no provider setting row exists (production-safe default)', async () => {
    process.env.NODE_ENV = 'development';
    const { adapter, resendSend, mailpitSend } = makeAdapter(null);

    await adapter.send(message);

    expect(resendSend).toHaveBeenCalledWith(message);
    expect(mailpitSend).not.toHaveBeenCalled();
  });

  it('delegates to Resend when the provider setting is explicitly RESEND', async () => {
    process.env.NODE_ENV = 'production';
    const { adapter, resendSend, mailpitSend } = makeAdapter('RESEND');

    await adapter.send(message);

    expect(resendSend).toHaveBeenCalledWith(message);
    expect(mailpitSend).not.toHaveBeenCalled();
  });

  it('delegates to Mailpit when the provider setting is MAILPIT and NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    const { adapter, resendSend, mailpitSend } = makeAdapter('MAILPIT');

    await adapter.send(message);

    expect(mailpitSend).toHaveBeenCalledWith(message);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('blocks delivery with EMAIL_DELIVERY_MISCONFIGURED when MAILPIT is selected but NODE_ENV=production, never falling back to Resend', async () => {
    process.env.NODE_ENV = 'production';
    const { adapter, resendSend, mailpitSend } = makeAdapter('MAILPIT');

    await expect(adapter.send(message)).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_MISCONFIGURED',
    });
    expect(resendSend).not.toHaveBeenCalled();
    expect(mailpitSend).not.toHaveBeenCalled();
  });
});
