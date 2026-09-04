import { Injectable } from '@nestjs/common';
import {
  MediaUploadRef,
  MediaUploadRefIntendedUse,
  MediaUploadRefStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `MediaUploadRef` — same data-ownership rule as
 * `ServiceRequestsRepository`/`QuotesRepository`/`ProfilesRepository` (see
 * goservice-docs/architecture/backend.md).
 *
 * GOS-72 — one shared upload-ref table serving Quote attachments, Quote
 * negotiation message images and Engagement chat message images. The three
 * consuming services (`AddQuoteAttachmentsService`,
 * `PostQuoteNegotiationMessageService`, `SendEngagementMessageService`) reuse
 * THIS class as a concrete provider — same "reuse the concrete repository
 * class directly, never import the resolver-bearing module" pattern the rest
 * of the backend already establishes.
 */
@Injectable()
export class MediaUploadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRef(data: {
    userId: string;
    storageKey: string;
    fileUrl: string;
    intendedUse: MediaUploadRefIntendedUse;
    expiresAt: Date;
  }): Promise<MediaUploadRef> {
    return this.prisma.mediaUploadRef.create({ data });
  }

  /**
   * Returns only the refs that are usable right now for `intendedUse`: owned
   * by `userId`, still `PENDING`, not yet expired, and requested for exactly
   * this `intendedUse`. The caller diffs the returned rows' ids against the
   * submitted list — any id missing from this result is invalid for one of
   * the reasons `invalidMediaUploadRef()` describes, all deliberately
   * collapsed into a single generic check (anti-enumeration), same as
   * `ServiceRequestsRepository.findUsablePendingUploadRefs` (GOS-38).
   */
  findUsablePendingRefs(
    userId: string,
    refIds: string[],
    intendedUse: MediaUploadRefIntendedUse,
  ): Promise<MediaUploadRef[]> {
    return this.prisma.mediaUploadRef.findMany({
      where: {
        id: { in: refIds },
        userId,
        status: MediaUploadRefStatus.PENDING,
        expiresAt: { gt: new Date() },
        intendedUse,
      },
    });
  }

  /**
   * Marks the given refs `CONSUMED`. Runs inside the caller-owned `tx` (the
   * consuming service always writes the domain row — `QuoteAttachment` /
   * message `imageUrl` — in the same transaction). The `status: PENDING`
   * guard in the `where` makes a concurrent double-spend a harmless no-op:
   * the caller re-checks `count` against the number of refs it expected and
   * rolls the whole transaction back on a mismatch — a stricter guarantee
   * than GOS-38's by-id-only consume write.
   */
  markConsumed(
    tx: Prisma.TransactionClient,
    refIds: string[],
  ): Promise<{ count: number }> {
    return tx.mediaUploadRef.updateMany({
      where: { id: { in: refIds }, status: MediaUploadRefStatus.PENDING },
      data: { status: MediaUploadRefStatus.CONSUMED, consumedAt: new Date() },
    });
  }
}
