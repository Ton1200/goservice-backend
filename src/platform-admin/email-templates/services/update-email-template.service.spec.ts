import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { EmailTemplatesRepository } from '../email-templates.repository';
import { UpdateEmailTemplateService } from './update-email-template.service';

describe('UpdateEmailTemplateService', () => {
  function makeService(
    existingRow: unknown = {
      key: 'verification_code',
      subject: 'old subject',
    },
  ) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findByKey = jest.fn().mockResolvedValue(existingRow);
    const updateByKey = jest
      .fn<
        Promise<Record<string, unknown>>,
        [
          unknown,
          string,
          { subject: string; htmlBody: string; textBody: string },
        ]
      >()
      .mockImplementation((_tx, key, data) =>
        Promise.resolve({
          id: 'template-1',
          key,
          ...data,
          updatedByAdminUser: { displayName: 'Jane Admin' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      );
    const emailTemplatesRepository = {
      findByKey,
      updateByKey,
    } as unknown as EmailTemplatesRepository;

    const write = jest
      .fn<Promise<{ id: string }>, [unknown, { metadata: unknown }]>()
      .mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateEmailTemplateService(
      prisma,
      emailTemplatesRepository,
      auditLogRepository,
    );

    return {
      service,
      $transaction,
      findByKey,
      updateByKey,
      write,
      fakeTx,
    };
  }

  const input = {
    subject: 'New subject',
    htmlBody: '<p>{{greeting}} {{code}}</p>',
    textBody: '{{greeting}} {{code}}',
  };

  it('updates the row and writes an AdminAuditLog row, inside the SAME $transaction', async () => {
    const { service, updateByKey, write, fakeTx, $transaction } = makeService();

    const result = await service.updateEmailTemplate(
      'admin-1',
      'verification_code',
      input,
    );

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateByKey).toHaveBeenCalledWith(fakeTx, 'verification_code', {
      subject: input.subject,
      htmlBody: input.htmlBody,
      textBody: input.textBody,
      updatedByAdminUserId: 'admin-1',
    });
    expect(write).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'EMAIL_TEMPLATE_UPDATED',
        targetType: 'EmailTemplate',
        targetKey: 'verification_code',
      }),
    );
    expect(result.subject).toBe(input.subject);
  });

  it('rejects a key that is not one of the 3 known email template keys, BEFORE any DB read/write', async () => {
    const { service, findByKey, updateByKey } = makeService();

    await expect(
      service.updateEmailTemplate('admin-1', 'not_a_real_key', input),
    ).rejects.toMatchObject({ code: 'UNKNOWN_EMAIL_TEMPLATE_KEY' });
    expect(findByKey).not.toHaveBeenCalled();
    expect(updateByKey).not.toHaveBeenCalled();
  });

  it('rejects a known key with no seeded row yet', async () => {
    const { service, updateByKey } = makeService(null);

    await expect(
      service.updateEmailTemplate('admin-1', 'verification_code', input),
    ).rejects.toMatchObject({ code: 'EMAIL_TEMPLATE_ROW_NOT_SEEDED' });
    expect(updateByKey).not.toHaveBeenCalled();
  });
});
