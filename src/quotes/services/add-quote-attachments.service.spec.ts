import { Logger } from '@nestjs/common';
import { MediaUploadRefIntendedUse, QuoteStatus } from '@prisma/client';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { QuotesRepository } from '../quotes.repository';
import { AddQuoteAttachmentsService } from './add-quote-attachments.service';

describe('AddQuoteAttachmentsService', () => {
  const professionalProfile = { id: 'pro-1', userId: 'user-1' };
  const sentQuote = {
    id: 'quote-1',
    professionalProfileId: professionalProfile.id,
    status: QuoteStatus.SENT,
    attachments: [],
  };

  function makeService(overrides?: {
    professionalProfile?: typeof professionalProfile | null;
    quote?: Record<string, unknown> | null;
    usableRefs?: { id: string; fileUrl: string }[];
    consumedCount?: number;
  }) {
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? professionalProfile
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const findById = jest
      .fn()
      .mockResolvedValue(
        overrides?.quote === undefined ? sentQuote : overrides.quote,
      );
    const createAttachments = jest.fn().mockResolvedValue({ count: 0 });
    const quotesRepository = {
      findById,
      createAttachments,
    } as unknown as QuotesRepository;

    const findUsablePendingRefs = jest
      .fn()
      .mockResolvedValue(overrides?.usableRefs ?? []);
    const markConsumed = jest
      .fn()
      .mockImplementation((_tx, ids: string[]) =>
        Promise.resolve({ count: overrides?.consumedCount ?? ids.length }),
      );
    const mediaUploadsRepository = {
      findUsablePendingRefs,
      markConsumed,
    } as unknown as MediaUploadsRepository;

    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback({}),
      ),
    } as unknown as PrismaService;

    const service = new AddQuoteAttachmentsService(
      prisma,
      profilesRepository,
      quotesRepository,
      mediaUploadsRepository,
    );

    return {
      service,
      findById,
      createAttachments,
      findUsablePendingRefs,
      markConsumed,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('throws PROFESSIONAL_PROFILE_REQUIRED when the caller has no ProfessionalProfile', async () => {
    const { service } = makeService({ professionalProfile: null });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-1']),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_REQUIRED' });
  });

  it('throws QUOTE_NOT_FOUND when the quote does not exist', async () => {
    const { service } = makeService({ quote: null });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-1']),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('throws QUOTE_NOT_FOUND (anti-enumeration) when the quote belongs to another Professional', async () => {
    const { service } = makeService({
      quote: { ...sentQuote, professionalProfileId: 'someone-else' },
    });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-1']),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' });
  });

  it('throws QUOTE_NOT_SENT when the quote is no longer SENT', async () => {
    const { service } = makeService({
      quote: { ...sentQuote, status: QuoteStatus.ACCEPTED },
    });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-1']),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_SENT' });
  });

  it('throws INVALID_MEDIA_UPLOAD_REF when a submitted ref is not usable (missing / wrong intendedUse / expired / consumed)', async () => {
    const { service, findUsablePendingRefs } = makeService({ usableRefs: [] });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-1']),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
    expect(findUsablePendingRefs).toHaveBeenCalledWith(
      'user-1',
      ['ref-1'],
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
  });

  it('creates one QuoteAttachment per ref in the client-submitted order and marks every ref CONSUMED', async () => {
    const refA = { id: 'ref-a', fileUrl: 'http://x/a.webp' };
    const refB = { id: 'ref-b', fileUrl: 'http://x/b.webp' };
    // Repository returns them out of order — the service must still persist
    // them in the ORIGINAL submitted order.
    const { service, createAttachments, markConsumed } = makeService({
      usableRefs: [refB, refA],
    });

    await service.addAttachments('user-1', 'quote-1', ['ref-a', 'ref-b']);

    expect(createAttachments).toHaveBeenCalledWith({}, 'quote-1', [
      { url: 'http://x/a.webp', order: 0 },
      { url: 'http://x/b.webp', order: 1 },
    ]);
    expect(markConsumed).toHaveBeenCalledWith({}, ['ref-a', 'ref-b']);
  });

  it('rolls back with INVALID_MEDIA_UPLOAD_REF when markConsumed affects fewer rows than expected (lost race)', async () => {
    const { service } = makeService({
      usableRefs: [{ id: 'ref-a', fileUrl: 'http://x/a.webp' }],
      consumedCount: 0,
    });

    await expect(
      service.addAttachments('user-1', 'quote-1', ['ref-a']),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_UPLOAD_REF' });
  });
});
