import { ConfigService } from '@nestjs/config';
import { ResendEmailClientAdapter } from './resend-email-client.adapter';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe('ResendEmailClientAdapter', () => {
  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({
        resendApiKey: 're_test_key',
        fromAddress: 'noreply@mail.workomm.com',
        fromName: 'GoService',
      }),
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    sendMock.mockReset();
  });

  it('sends via the Resend SDK with the configured from address/name', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    const adapter = new ResendEmailClientAdapter(makeConfigService());

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

  it('throws when Resend returns an error, so BullMQ retries the job', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        message: 'invalid to address',
        statusCode: 422,
      },
    });
    const adapter = new ResendEmailClientAdapter(makeConfigService());

    await expect(
      adapter.send({
        to: 'bad',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
      }),
    ).rejects.toThrow(/Resend send failed/);
  });
});
