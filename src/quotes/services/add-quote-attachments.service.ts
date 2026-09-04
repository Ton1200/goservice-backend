import { Injectable, Logger } from '@nestjs/common';
import { MediaUploadRefIntendedUse, QuoteStatus } from '@prisma/client';
import { invalidMediaUploadRef } from '../../media-uploads/errors/invalid-media-upload-ref.error';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../errors/professional-profile-required.error';
import { quoteNotFound } from '../errors/quote-not-found.error';
import { quoteNotSent } from '../errors/quote-not-sent.error';
import { QuoteModel } from '../models/quote.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Mutation.addQuoteAttachment` (GOS-72). The owning
 * `ProfessionalProfile` is ALWAYS resolved server-side from `@CurrentUser()`
 * — this service never receives or trusts a `professionalProfileId`. The
 * `MediaUploadRef`s are validated (owned by the caller, still `PENDING`, not
 * expired, requested for `QUOTE_ATTACHMENT`) and marked `CONSUMED` in the
 * SAME transaction that creates the `QuoteAttachment` rows — a ref can never
 * be spent without an attachment to show for it, and vice versa.
 *
 * Owns the transaction boundary itself (injects `PrismaService` directly,
 * same pattern as `PostQuoteNegotiationMessageService`) since it spans two
 * modules' tables (`quotes/`'s `QuoteAttachment`, `media-uploads/`'s
 * `MediaUploadRef`).
 */
@Injectable()
export class AddQuoteAttachmentsService {
  private readonly logger = new Logger(AddQuoteAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly quotesRepository: QuotesRepository,
    private readonly mediaUploadsRepository: MediaUploadsRepository,
  ) {}

  async addAttachments(
    userId: string,
    quoteId: string,
    mediaUploadRefIds: string[],
  ): Promise<QuoteModel> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    const quote = await this.quotesRepository.findById(quoteId);
    if (!quote || quote.professionalProfileId !== professionalProfile.id) {
      // Same code for "doesn't exist" and "not yours" — anti-enumeration,
      // see `quoteNotFound()`'s own comment.
      throw quoteNotFound();
    }
    if (quote.status !== QuoteStatus.SENT) {
      // Attaching reference images to a Quote that has already been
      // withdrawn/rejected/accepted serves no purpose — the caller already
      // knows this is their own resource, so disclosing its state is safe
      // (see `quoteNotSent()`'s own comment). Whether this window should be
      // wider is flagged as an open product question in domain-model.md.
      throw quoteNotSent();
    }

    const usableRefs = await this.mediaUploadsRepository.findUsablePendingRefs(
      userId,
      mediaUploadRefIds,
      MediaUploadRefIntendedUse.QUOTE_ATTACHMENT,
    );
    if (usableRefs.length !== mediaUploadRefIds.length) {
      throw invalidMediaUploadRef();
    }

    // Re-map into the client-submitted order so `QuoteAttachment.order` is
    // stable and independent of DB row order — same approach as
    // `PublishServiceRequestService`.
    const refsById = new Map(usableRefs.map((ref) => [ref.id, ref]));
    const orderedRefs = mediaUploadRefIds.map((id) => refsById.get(id)!);

    await this.prisma.$transaction(async (tx) => {
      await this.quotesRepository.createAttachments(
        tx,
        quoteId,
        orderedRefs.map((ref, index) => ({ url: ref.fileUrl, order: index })),
      );
      const { count } = await this.mediaUploadsRepository.markConsumed(
        tx,
        mediaUploadRefIds,
      );
      if (count !== mediaUploadRefIds.length) {
        // A concurrent consume spent one of these refs between the read
        // above and this write — roll the whole transaction back.
        throw invalidMediaUploadRef();
      }
    });

    this.logger.log({
      event: 'quote_attachments_added',
      outcome: 'success',
      quoteId,
      count: mediaUploadRefIds.length,
    });

    // Re-read so the returned Quote carries the freshly-created attachments.
    return (await this.quotesRepository.findById(quoteId))!;
  }
}
