import { Injectable } from '@nestjs/common';
import {
  Prisma,
  QuoteNegotiationParty,
  QuotePriceProposalStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MESSAGE_INCLUDE = {
  priceProposal: true,
} satisfies Prisma.QuoteNegotiationMessageInclude;

export type QuoteNegotiationMessageWithRelations =
  Prisma.QuoteNegotiationMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `QuoteNegotiationMessage`/`QuotePriceProposal` — same data-ownership rule
 * as `QuotesRepository`/`ProfilesRepository` (see
 * goservice-docs/architecture/backend.md). `Quote.negotiatedPrice` is
 * deliberately NOT written from here — see `QuotesRepository.setNegotiatedPrice`'s
 * own header comment for why that write stays on the repository that
 * already claims exclusive ownership of the `Quote` table.
 */
@Injectable()
export class QuoteNegotiationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMessagesByQuoteId(
    quoteId: string,
  ): Promise<QuoteNegotiationMessageWithRelations[]> {
    return this.prisma.quoteNegotiationMessage.findMany({
      where: { quoteId },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Part of `PostQuoteNegotiationMessageService`'s transaction. Runs inside
   * the caller-owned `tx` — never opens its own transaction.
   */
  createMessage(
    tx: Prisma.TransactionClient,
    data: {
      quoteId: string;
      authorRole: QuoteNegotiationParty;
      authorCustomerProfileId: string | null;
      authorProfessionalProfileId: string | null;
      message: string;
      // GOS-72 — the consumed `MediaUploadRef.fileUrl`, or `null` when no
      // image was attached.
      imageUrl: string | null;
    },
  ) {
    return tx.quoteNegotiationMessage.create({ data });
  }

  /**
   * CAS-supersede: every currently `PENDING` proposal on this Quote becomes
   * `SUPERSEDED` — guarantees at most one `PENDING` proposal exists per
   * Quote at any time. Zero rows affected is a valid, expected outcome (no
   * prior pending proposal) — unlike the guarded single-row CAS writes
   * elsewhere in this repository, this bulk write's result is never
   * count-checked. Runs inside the caller's own `tx`.
   */
  supersedePendingProposals(
    tx: Prisma.TransactionClient,
    quoteId: string,
  ): Promise<{ count: number }> {
    return tx.quotePriceProposal.updateMany({
      where: { quoteId, status: QuotePriceProposalStatus.PENDING },
      data: { status: QuotePriceProposalStatus.SUPERSEDED },
    });
  }

  /**
   * Part of `PostQuoteNegotiationMessageService`'s transaction, always
   * called AFTER `supersedePendingProposals` above, for the SAME `quoteId`.
   * Runs inside the caller's own `tx`.
   */
  createPriceProposal(
    tx: Prisma.TransactionClient,
    data: {
      quoteId: string;
      negotiationMessageId: string;
      proposedByRole: QuoteNegotiationParty;
      proposedByCustomerProfileId: string | null;
      proposedByProfessionalProfileId: string | null;
      proposedPrice: number;
    },
  ) {
    return tx.quotePriceProposal.create({ data });
  }

  findProposalById(id: string) {
    return this.prisma.quotePriceProposal.findUnique({ where: { id } });
  }

  /**
   * GOS-53 follow-up — `AcceptQuoteService` (`src/quotes/`) reuses THIS
   * class as a concrete provider (same "reuse the concrete repository class
   * directly, never import the resolver-bearing Module" pattern this
   * codebase already establishes) to block accepting a `Quote` while an
   * unresolved `PENDING` `QuotePriceProposal` exists — see
   * `quoteHasPendingPriceProposal()`'s own comment for why. Minimal select
   * (existence check only — no proposal content is ever needed here).
   * `supersedePendingProposals` above already guarantees at most one
   * `PENDING` proposal per Quote at any time, so `findFirst` never needs an
   * `orderBy` to disambiguate.
   */
  findPendingProposalByQuoteId(
    quoteId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.quotePriceProposal.findFirst({
      where: { quoteId, status: QuotePriceProposalStatus.PENDING },
      select: { id: true },
    });
  }

  /**
   * `AcceptQuotePriceProposalService`'s CAS — only actually accepts while
   * still `PENDING`. `count === 0` covers both "already
   * accepted/rejected/superseded" and a lost race (a concurrent
   * accept/reject/new-proposal-supersede). Runs inside the caller's own
   * `tx` — always called alongside `QuotesRepository.setNegotiatedPrice` in
   * the SAME transaction (see `AcceptQuotePriceProposalService`).
   */
  acceptProposal(
    tx: Prisma.TransactionClient,
    id: string,
    resolvedBy: {
      resolvedByCustomerProfileId: string | null;
      resolvedByProfessionalProfileId: string | null;
    },
  ): Promise<{ count: number }> {
    return tx.quotePriceProposal.updateMany({
      where: { id, status: QuotePriceProposalStatus.PENDING },
      data: {
        status: QuotePriceProposalStatus.ACCEPTED,
        resolvedAt: new Date(),
        ...resolvedBy,
      },
    });
  }

  /**
   * `RejectQuotePriceProposalService`'s CAS — same idiom as `acceptProposal`
   * above. Unlike `acceptProposal`, this never needs to run inside a
   * multi-table transaction (rejecting a proposal touches nothing on
   * `Quote`) — a single guarded `updateMany`, same pattern as
   * `QuotesRepository.reject`.
   */
  rejectProposal(
    id: string,
    resolvedBy: {
      resolvedByCustomerProfileId: string | null;
      resolvedByProfessionalProfileId: string | null;
    },
  ): Promise<{ count: number }> {
    return this.prisma.quotePriceProposal.updateMany({
      where: { id, status: QuotePriceProposalStatus.PENDING },
      data: {
        status: QuotePriceProposalStatus.REJECTED,
        resolvedAt: new Date(),
        ...resolvedBy,
      },
    });
  }
}
