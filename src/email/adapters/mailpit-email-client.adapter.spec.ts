import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { MailpitEmailClientAdapter } from './mailpit-email-client.adapter';

const sendMailMock = jest.fn();
const createTransportMock = jest.fn(() => ({ sendMail: sendMailMock }));

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

describe('MailpitEmailClientAdapter', () => {
  function makeConfigService(
    overrides?: Partial<AppConfig['mailpit']>,
  ): ConfigService<AppConfig, true> {
    const get = jest.fn().mockReturnValue({
      smtpHost: 'localhost',
      smtpPort: 1025,
      ...overrides,
    });
    return { get } as unknown as ConfigService<AppConfig, true>;
  }

  beforeEach(() => {
    sendMailMock.mockReset();
    createTransportMock.mockClear();
  });

  it('sends via SMTP through nodemailer, using the configured Mailpit host/port', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    const adapter = new MailpitEmailClientAdapter(
      makeConfigService({ smtpHost: 'localhost', smtpPort: 1025 }),
    );

    await adapter.send({
      to: 'user@example.com',
      subject: 'Subject',
      text: 'Text body',
      html: '<p>Text body</p>',
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Subject',
        text: 'Text body',
        html: '<p>Text body</p>',
      }),
    );
  });

  it('builds a fresh transport on every send() call, not cached from construction', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    const adapter = new MailpitEmailClientAdapter(makeConfigService());

    await adapter.send({
      to: 'user1@example.com',
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

    expect(createTransportMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows so BullMQ retries when the SMTP send fails (e.g. Mailpit not running)', async () => {
    sendMailMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = new MailpitEmailClientAdapter(makeConfigService());

    await expect(
      adapter.send({
        to: 'user@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
      }),
    ).rejects.toThrow(/Mailpit send failed/);
  });
});
