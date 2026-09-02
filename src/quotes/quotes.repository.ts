import { Injectable } from '@nestjs/common';
import { Prisma, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const QUOTE_INCLUDE = {
  professionalProfile: {
    include: {
      specializations: {
        include: { category: true },
        orderBy: { order: 'asc' as const },
      },
    },
  },
  engagement: true,
} satisfies Prisma.QuoteInclude;

export type QuoteWithRelations = Prisma.QuoteGetPayload<{
  include: typeof QUOTE_INCLUDE;
}>;

// ---- platform-admin `quotes`/`quoteDetail` capability (Quotes admin grid
// follow-up, 2026-08-19) — same "reuse the concrete repository class
// directly, never import the resolver-bearing QuotesModule" pattern
// `ServiceRequestsRepository`'s own `ADMIN_SERVICE_REQUEST_SELECT`/
// `findManyForAdmin`/`countAllForAdmin`/`findByIdForAdmin` already
// establish for `platform-admin/service-requests/`. `serviceRequest`/
// `professionalProfile.user` are the "relación de usuarios" an admin needs
// to make each row actionable — never just opaque
// `serviceRequestId`/`professionalProfileId`s.

/**
 * Grid-row select — deliberately lighter than `ADMIN_QUOTE_DETAIL_SELECT`
 * below (no `engagement`), same "cheap select for the grid, richer select
 * for the one-row detail view" split `ADMIN_SERVICE_REQUEST_SELECT`/
 * `ADMIN_SERVICE_REQUEST_DETAIL_SELECT` already establish.
 */
const ADMIN_QUOTE_SELECT = {
  id: true,
  price: true,
  // GOS-53 (Quote Negotiation) admin follow-up — the negotiated price
  // agreed via the Quote Negotiation thread, if any (`Quote.negotiatedPrice`
  // — see that column's own schema comment). `null` until/unless a
  // `QuotePriceProposal` on this Quote is accepted.
  negotiatedPrice: true,
  message: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // GOS-53 admin follow-up — a cheap, permission-light "is there
  // negotiation activity here" signal for the grid/detail view. Actually
  // reading the thread itself still requires `Permission.QUOTE_NEGOTIATION_READ`
  // via the separate `adminQuoteNegotiationThread` query (gated by
  // `QuoteNegotiationModuleEnabledGuard` too) — this count alone never
  // exposes message content.
  _count: { select: { negotiationMessages: true } },
  serviceRequest: {
    select: {
      id: true,
      description: true,
      status: true,
      // Full Category row (not just id/name) — AdminQuoteServiceRequestModel
      // reuses the full consumer-facing `Category` @ObjectType shape
      // (createdAt/updatedAt included), same "orphaned type made reachable"
      // pattern `ADMIN_SERVICE_REQUEST_SELECT` already establishes.
      category: true,
      // The customer's real name (nombre / apellido) now lives on the
      // `CustomerProfile` itself, so this can still reuse
      // `AdminServiceRequestCustomerModel` verbatim — same type, same
      // name+email column the Service Requests grid's own customer column
      // uses — rather than inventing a near-duplicate, narrower admin-only
      // type. The owning `User`'s own `firstName`/`lastName` are a separate
      // identity-level name and no longer read here.
      customerProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          user: {
            select: { id: true, email: true },
          },
        },
      },
    },
  },
  professionalProfile: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      // Optional "nombre comercial" — may be null.
      displayName: true,
      user: {
        select: { id: true, email: true },
      },
    },
  },
} satisfies Prisma.QuoteSelect;

export type AdminQuoteRow = Prisma.QuoteGetPayload<{
  select: typeof ADMIN_QUOTE_SELECT;
}>;

/**
 * One-row detail select — adds the linked `Engagement` (nullable — a Quote
 * is only ever accepted into one if/when it was actually accepted) on top
 * of everything `ADMIN_QUOTE_SELECT` already carries.
 */
const ADMIN_QUOTE_DETAIL_SELECT = {
  ...ADMIN_QUOTE_SELECT,
  engagement: {
    select: { id: true, status: true, createdAt: true },
  },
} satisfies Prisma.QuoteSelect;

export type AdminQuoteDetailRow = Prisma.QuoteGetPayload<{
  select: typeof ADMIN_QUOTE_DETAIL_SELECT;
}>;

/**
 * The ONLY place in this codebase that issues Prisma queries for `Quote` —
 * same data-ownership rule as `ServiceRequestsRepository`/
 * `ProfilesRepository` (see goservice-docs/architecture/backend.md).
 *
 * `withdraw`/`reject`/`transitionToAcceptedIfSent` are all guarded
 * `updateMany` CAS writes (`WHERE ... status = 'SENT'`), never a plain
 * `update()` — same idiom as
 * `UsersRepository.transitionToPendingApprovalIfEmailVerified`/
 * `transitionFromPendingApproval` and
 * `ServiceRequestsRepository.cancel()` — this is the real mechanism making
 * every concurrent state transition on a `Quote` race-safe, not just an
 * application-level pre-check.
 */
@Injectable()
export class QuotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<QuoteWithRelations | null> {
    return this.prisma.quote.findUnique({
      where: { id },
      include: QUOTE_INCLUDE,
    });
  }

  create(data: {
    serviceRequestId: string;
    professionalProfileId: string;
    price: number;
    message: string;
  }): Promise<QuoteWithRelations> {
    return this.prisma.quote.create({ data, include: QUOTE_INCLUDE });
  }

  findManyByServiceRequestId(
    serviceRequestId: string,
  ): Promise<QuoteWithRelations[]> {
    return this.prisma.quote.findMany({
      where: { serviceRequestId },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  findManyByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<QuoteWithRelations[]> {
    return this.prisma.quote.findMany({
      where: { professionalProfileId },
      include: QUOTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * `WithdrawQuoteService`'s CAS — only actually withdraws while still
   * `SENT`. `count === 0` covers both "already withdrawn/rejected/accepted"
   * and a lost race against a concurrent `acceptQuote`.
   */
  withdraw(id: string): Promise<{ count: number }> {
    return this.prisma.quote.updateMany({
      where: { id, status: QuoteStatus.SENT },
      data: { status: QuoteStatus.WITHDRAWN, withdrawnAt: new Date() },
    });
  }

  /**
   * `RejectQuoteService`'s CAS — an explicit Customer rejection. Same
   * `REJECTED` value `rejectSiblingsSent` below also uses for the automatic
   * sibling-rejection case — see `QuoteStatus`'s own schema comment for why
   * that's deliberate, not an accident.
   */
  reject(id: string): Promise<{ count: number }> {
    return this.prisma.quote.updateMany({
      where: { id, status: QuoteStatus.SENT },
      data: { status: QuoteStatus.REJECTED, rejectedAt: new Date() },
    });
  }

  /**
   * Part of `AcceptQuoteService`'s transaction — CAS `SENT` -> `ACCEPTED`,
   * scoped to both the quote id AND its `serviceRequestId` (defense in
   * depth on top of the caller's own pre-validation). Runs inside the
   * caller-owned `tx` — never opens its own transaction.
   */
  transitionToAcceptedIfSent(
    tx: Prisma.TransactionClient,
    quoteId: string,
    serviceRequestId: string,
  ): Promise<{ count: number }> {
    return tx.quote.updateMany({
      where: { id: quoteId, serviceRequestId, status: QuoteStatus.SENT },
      data: { status: QuoteStatus.ACCEPTED, acceptedAt: new Date() },
    });
  }

  /**
   * Part of `AcceptQuoteService`'s transaction — bulk auto-rejects every
   * OTHER still-`SENT` Quote on the same `ServiceRequest`. Zero rows
   * affected is a valid, expected outcome (e.g. no other Quotes exist) —
   * unlike the two CAS writes above, this one's result is never checked
   * against `count === 1`.
   */
  rejectSiblingsSent(
    tx: Prisma.TransactionClient,
    serviceRequestId: string,
    acceptedQuoteId: string,
  ): Promise<{ count: number }> {
    return tx.quote.updateMany({
      where: {
        serviceRequestId,
        status: QuoteStatus.SENT,
        id: { not: acceptedQuoteId },
      },
      data: { status: QuoteStatus.REJECTED, rejectedAt: new Date() },
    });
  }

  // ---- GOS-53 (Quote Negotiation) — `AcceptQuotePriceProposalService`
  // (`src/quote-negotiation/`) reuses THIS class as a concrete provider,
  // same "reuse the concrete repository class directly, never import the
  // resolver-bearing QuotesModule" pattern already established elsewhere.
  // Deliberately kept HERE (not on `QuoteNegotiationRepository`) — this
  // class's own header comment already claims "the ONLY place in this
  // codebase that issues Prisma queries for Quote"; a write to
  // `Quote.negotiatedPrice` from a second repository would break that rule.
  // Runs inside the caller's own `tx` (same "no separate transaction"
  // convention as `transitionToAcceptedIfSent`/`rejectSiblingsSent` above)
  // — always called alongside `QuoteNegotiationRepository.acceptProposal`'s
  // own CAS write, in the same transaction.

  setNegotiatedPrice(
    tx: Prisma.TransactionClient,
    quoteId: string,
    negotiatedPrice: number,
  ): Promise<{ id: string }> {
    return tx.quote.update({
      where: { id: quoteId },
      data: { negotiatedPrice },
      select: { id: true },
    });
  }

  // ---- platform-admin `quotes`/`quoteDetail` (Quotes admin grid
  // follow-up, 2026-08-19) — see the ADMIN_QUOTE_SELECT block above.

  findManyForAdmin(params: {
    limit: number;
    offset: number;
  }): Promise<AdminQuoteRow[]> {
    return this.prisma.quote.findMany({
      select: ADMIN_QUOTE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  countAllForAdmin(): Promise<number> {
    return this.prisma.quote.count();
  }

  findByIdForAdmin(id: string): Promise<AdminQuoteDetailRow | null> {
    return this.prisma.quote.findUnique({
      where: { id },
      select: ADMIN_QUOTE_DETAIL_SELECT,
    });
  }
}
