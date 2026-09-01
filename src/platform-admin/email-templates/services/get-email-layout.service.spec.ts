import { EmailLayoutRepository } from '../email-layout.repository';
import { GetEmailLayoutService } from './get-email-layout.service';

describe('GetEmailLayoutService', () => {
  it('delegates to EmailLayoutRepository.get() and maps the row to EmailLayoutModel', async () => {
    const row = {
      id: 'singleton',
      headerHtml: '<header></header>',
      footerHtml: '<footer></footer>',
      headerText: '',
      footerText: '---',
      updatedByAdminUserId: 'admin-1',
      updatedByAdminUser: { displayName: 'Jane Admin' },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const get = jest.fn().mockResolvedValue(row);
    const emailLayoutRepository = { get } as unknown as EmailLayoutRepository;
    const service = new GetEmailLayoutService(emailLayoutRepository);

    const result = await service.getEmailLayout();

    expect(get).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 'singleton',
      headerHtml: '<header></header>',
      footerHtml: '<footer></footer>',
      updatedBy: 'Jane Admin',
    });
  });

  it('throws EMAIL_LAYOUT_ROW_NOT_SEEDED when no row exists yet', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const emailLayoutRepository = { get } as unknown as EmailLayoutRepository;
    const service = new GetEmailLayoutService(emailLayoutRepository);

    await expect(service.getEmailLayout()).rejects.toMatchObject({
      code: 'EMAIL_LAYOUT_ROW_NOT_SEEDED',
    });
  });
});
