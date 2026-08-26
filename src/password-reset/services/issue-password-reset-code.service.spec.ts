import { ConfigService } from '@nestjs/config';
import { PasswordResetEmailSenderPort } from '../ports/password-reset-email-sender.port';
import { PasswordResetRepository } from '../password-reset.repository';
import { IssuePasswordResetCodeService } from './issue-password-reset-code.service';

describe('IssuePasswordResetCodeService', () => {
  const RESEND_COOLDOWN_SECONDS = 60;

  function makeConfigService() {
    return {
      get: jest.fn().mockReturnValue({
        codeTtlMinutes: 15,
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        maxAttempts: 5,
      }),
    } as unknown as ConfigService;
  }

  function makeService(options: { activeCode?: unknown }) {
    const findActivePasswordResetCode = jest
      .fn()
      .mockResolvedValue(options.activeCode ?? null);
    const invalidateCode = jest.fn().mockResolvedValue(undefined);
    const createPasswordResetCode = jest
      .fn()
      .mockResolvedValue({ id: 'new-code' });
    const passwordResetRepository = {
      findActivePasswordResetCode,
      invalidateCode,
      createPasswordResetCode,
    } as unknown as PasswordResetRepository;

    const sendPasswordResetCode = jest.fn().mockResolvedValue(undefined);
    const passwordResetEmailSender = {
      sendPasswordResetCode,
    } as unknown as PasswordResetEmailSenderPort;

    const service = new IssuePasswordResetCodeService(
      passwordResetRepository,
      passwordResetEmailSender,
      makeConfigService(),
    );

    return {
      service,
      invalidateCode,
      createPasswordResetCode,
      sendPasswordResetCode,
    };
  }

  it('issues a new code when there is no active code at all', async () => {
    const { service, createPasswordResetCode, sendPasswordResetCode } =
      makeService({ activeCode: null });

    const result = await service.issueForUser('u1', 'jane@example.com', 'Jane');

    expect(result).toEqual({ issued: true });
    expect(createPasswordResetCode).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
    expect(sendPasswordResetCode).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
      'Jane',
    );
  });

  it('is a no-op within the cooldown: no new code, no invalidation, no email', async () => {
    const createdAt = new Date(Date.now() - 10_000); // 10s ago, within 60s cooldown
    const {
      service,
      createPasswordResetCode,
      invalidateCode,
      sendPasswordResetCode,
    } = makeService({ activeCode: { id: 'code-1', createdAt } });

    const result = await service.issueForUser('u1', 'jane@example.com', 'Jane');

    expect(result).toEqual({ issued: false });
    expect(createPasswordResetCode).not.toHaveBeenCalled();
    expect(invalidateCode).not.toHaveBeenCalled();
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('invalidates the prior code and issues a new one once the cooldown has elapsed', async () => {
    const createdAt = new Date(Date.now() - 120_000); // past 60s cooldown
    const { service, invalidateCode, createPasswordResetCode } = makeService({
      activeCode: { id: 'code-1', createdAt },
    });

    const result = await service.issueForUser('u1', 'jane@example.com', 'Jane');

    expect(result).toEqual({ issued: true });
    expect(invalidateCode).toHaveBeenCalledWith('code-1');
    expect(createPasswordResetCode).toHaveBeenCalled();
  });
});
