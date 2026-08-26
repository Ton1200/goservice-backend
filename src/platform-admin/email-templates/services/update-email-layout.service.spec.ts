import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { EmailLayoutRepository } from '../email-layout.repository';
import { UpdateEmailLayoutService } from './update-email-layout.service';

describe('UpdateEmailLayoutService', () => {
  function makeService() {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const upsert = jest
      .fn<
        Promise<Record<string, unknown>>,
        [
          unknown,
          {
            headerHtml: string;
            footerHtml: string;
            headerText: string;
            footerText: string;
            logoUrl: string | null;
            updatedByAdminUserId: string;
          },
        ]
      >()
      .mockImplementation((_tx, data) =>
        Promise.resolve({
          id: 'singleton',
          ...data,
          updatedByAdminUser: { displayName: 'Jane Admin' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      );
    const emailLayoutRepository = {
      upsert,
    } as unknown as EmailLayoutRepository;

    const write = jest
      .fn<Promise<{ id: string }>, [unknown, { metadata: unknown }]>()
      .mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateEmailLayoutService(
      prisma,
      emailLayoutRepository,
      auditLogRepository,
    );

    return { service, $transaction, upsert, write, fakeTx };
  }

  const input = {
    headerHtml: '<header>{{greeting}}</header>',
    footerHtml: '<footer>Footer</footer>',
    headerText: '',
    footerText: '---',
    logoUrl: 'http://localhost:3000/uploads/abc123.png',
  };

  it('upserts the singleton row and writes an AdminAuditLog row, inside the SAME $transaction', async () => {
    const { service, upsert, write, fakeTx, $transaction } = makeService();

    const result = await service.updateEmailLayout('admin-1', input);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(fakeTx, {
      headerHtml: input.headerHtml,
      footerHtml: input.footerHtml,
      headerText: input.headerText,
      footerText: input.footerText,
      logoUrl: input.logoUrl,
      updatedByAdminUserId: 'admin-1',
    });
    expect(write).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'EMAIL_LAYOUT_UPDATED',
        targetType: 'EmailLayout',
        targetKey: 'singleton',
      }),
    );
    expect(result.headerHtml).toBe(input.headerHtml);
  });

  it('persists logoUrl: null when the input omits it (?? null, never undefined reaching Prisma)', async () => {
    const { service, upsert } = makeService();

    await service.updateEmailLayout('admin-1', {
      headerHtml: input.headerHtml,
      footerHtml: input.footerHtml,
      headerText: input.headerText,
      footerText: input.footerText,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logoUrl: null }),
    );
  });
});
