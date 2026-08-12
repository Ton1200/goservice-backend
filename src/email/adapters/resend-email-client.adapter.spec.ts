import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RESEND_PLATFORM_SETTING_KEYS } from '../constants/resend-settings.constants';
import { ResendEmailClientAdapter } from './resend-email-client.adapter';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation((apiKey: string) => ({
    apiKey,
    emails: { send: sendMock },
  })),
}));

describe('ResendEmailClientAdapter', () => {
  function makePlatformSettingPort(values: Record<string, string | null>) {
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;
    return { platformSettingPort, getValue };
  }

  function enabledValues(overrides?: Record<string, string>) {
    return {
      [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'true',
      [RESEND_PLATFORM_SETTING_KEYS.apiKey]: 're_test_key',
      [RESEND_PLATFORM_SETTING_KEYS.fromAddress]: 'noreply@mail.workomm.com',
      [RESEND_PLATFORM_SETTING_KEYS.fromName]: 'GoService',
      ...overrides,
    };
  }

  beforeEach(() => {
    sendMock.mockReset();
  });

  it('sends via the Resend SDK, reading the configured from address/name live', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const { platformSettingPort } = makePlatformSettingPort(enabledValues());
    const adapter = new ResendEmailClientAdapter(platformSettingPort);

    await adapter.send({
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text body',
      html: '<p>Text body</p>',
    });

    expect(sendMock).toHaveBeenCalledWith({
      from: 'GoService <noreply@mail.workomm.com>',
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text body',
      html: '<p>Text body</p>',
    });
  });

  it('reads config fresh on every send() call, not cached from construction', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const { platformSettingPort, getValue } =
      makePlatformSettingPort(enabledValues());
    const adapter = new ResendEmailClientAdapter(platformSettingPort);

    await adapter.send({
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
    });
    await adapter.send({
      to: 'user2@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
    });

    expect(getValue).toHaveBeenCalledTimes(8); // 4 keys x 2 sends
  });

  it('throws when Resend returns an error, so BullMQ retries the job', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        message: 'invalid to address',
        statusCode: 422,
      },
    });
    const { platformSettingPort } = makePlatformSettingPort(enabledValues());
    const adapter = new ResendEmailClientAdapter(platformSettingPort);

    await expect(
      adapter.send({
        to: 'bad',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
      }),
    ).rejects.toThrow(/Resend send failed/);
  });

  it('fails loudly with EMAIL_DELIVERY_DISABLED if invoked while disabled (defense-in-depth)', async () => {
    const { platformSettingPort } = makePlatformSettingPort(
      enabledValues({ [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'false' }),
    );
    const adapter = new ResendEmailClientAdapter(platformSettingPort);

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_DISABLED' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails loudly with EMAIL_DELIVERY_MISCONFIGURED if invoked while enabled but missing the api-key', async () => {
    const values = enabledValues();
    values[RESEND_PLATFORM_SETTING_KEYS.apiKey] = '';
    const { platformSettingPort } = makePlatformSettingPort(values);
    const adapter = new ResendEmailClientAdapter(platformSettingPort);

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_MISCONFIGURED' });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
