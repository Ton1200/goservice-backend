import { EmailTemplatesRepository } from '../email-templates.repository';
import { ListEmailTemplatesService } from './list-email-templates.service';

describe('ListEmailTemplatesService', () => {
  it('delegates to EmailTemplatesRepository.findAll() and maps rows to EmailTemplateModel', async () => {
    const rows = [
      {
        id: 'template-1',
        key: 'verification_code',
        subject: 'Tu código de verificación',
        htmlBody: '<p>{{greeting}} {{code}}</p>',
        textBody: '{{greeting}} {{code}}',
        updatedByAdminUserId: 'admin-1',
        updatedByAdminUser: { displayName: 'Jane Admin' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ] as unknown[];
    const findAll = jest.fn().mockResolvedValue(rows);
    const emailTemplatesRepository = {
      findAll,
    } as unknown as EmailTemplatesRepository;
    const service = new ListEmailTemplatesService(emailTemplatesRepository);

    const result = await service.listEmailTemplates();

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'template-1',
      key: 'verification_code',
      subject: 'Tu código de verificación',
      updatedBy: 'Jane Admin',
    });
  });
});
