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
  message: true,
  status: true,
  createdAt: true,
  updatedAt: true,
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
      // Includes user.firstName/lastName (beyond the bare minimum needed to
      // just "identify" the request) specifically so this can reuse
      // `AdminServiceRequestCustomerModel` verbatim — same type, same
      // name+email formatter fallback pattern the Service Requests grid's
      // own customer column already uses — rather than inventing a
      // near-duplicate, narrower admin-only type.
      customerProfile: {
        select: {
          id: true,
          displayName: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      },
    },
  },
  professionalProfile: {
    select: {
      id: true,
      displayName: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
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
