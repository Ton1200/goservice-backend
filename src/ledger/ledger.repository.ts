import { Injectable } from '@nestjs/common';
import { LedgerEntry, LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminLedgerEntriesFilter {
  engagementId?: string;
  professionalProfileId?: string;
  from?: Date;
  to?: Date;
}

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `LedgerEntry` — same data-ownership rule as `EngagementsRepository`/
 * `ReviewsRepository` (see goservice-docs/architecture/backend.md).
 *
 * **Append-only by construction**: no `update`/`delete` method exists here,
 * and never should — a financial audit trail is corrected by writing a NEW,
 * offsetting entry, never by mutating history. Every write method below
 * takes an EXTERNALLY-opened `tx` — this repository never opens its own
 * transaction — same idiom as `QuoteNegotiationRepository`/
 * `EngagementsRepository.cancelIfActive`: the caller (`RecordCustomerCancellationChargeService`/
 * `RecordProfessionalCancellationRefundService`) always runs inside the
 * SAME `prisma.$transaction` as the `Engagement` status transition that
 * triggered it, so a ledger-write failure rolls back the whole cancellation.
 *
 * `createCustomerCancellationChargeEntries` issues three EXPLICIT
 * `tx.ledgerEntry.create(...)` calls (never `createMany`) so the caller/its
 * tests get the real created rows back, not just a `{ count }`.
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GOS-109 — the 3-row cancellation-charge event (DEC-008 point 5): a
   * negative `CUSTOMER_CANCELLATION_FEE` (the balancing leg — see
   * `RecordCustomerCancellationChargeService`'s own header comment for why
   * a pure 2-row commission/net split cannot sum to zero on its own),
   * followed by a positive `PLATFORM_COMMISSION` and a positive
   * `PROFESSIONAL_NET_CREDIT`. All 3 share `engagementId`/`currency`/
   * `commissionPercentApplied`. Runs inside the caller's own `tx`.
   */
  async createCustomerCancellationChargeEntries(
    tx: Prisma.TransactionClient,
    data: {
      engagementId: string;
      currency: string;
      customerProfileId: string;
      professionalProfileId: string;
      feeAmount: number;
      commissionAmount: number;
      netAmount: number;
      commissionPercentApplied: number;
    },
  ): Promise<[LedgerEntry, LedgerEntry, LedgerEntry]> {
    const fee = await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -data.feeAmount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        professionalProfileId: data.professionalProfileId,
        commissionPercentApplied: data.commissionPercentApplied,
      },
    });
    const commission = await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.PLATFORM_COMMISSION,
        amount: data.commissionAmount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        professionalProfileId: data.professionalProfileId,
        commissionPercentApplied: data.commissionPercentApplied,
      },
    });
    const net = await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.PROFESSIONAL_NET_CREDIT,
        amount: data.netAmount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        professionalProfileId: data.professionalProfileId,
        commissionPercentApplied: data.commissionPercentApplied,
      },
    });
    return [fee, commission, net];
  }

  /**
   * GOS-117/GOS-109 — the single `REFUND` entry for a Professional-initiated
   * cancellation (DEC-008: "unaffected by this DEC ... full refund to the
   * Customer, no charge"). No `commissionPercentApplied` — nothing was ever
   * charged, so there is nothing to split. Runs inside the caller's own
   * `tx`.
   */
  createRefundEntry(
    tx: Prisma.TransactionClient,
    data: {
      engagementId: string;
      currency: string;
      customerProfileId: string;
      amount: number;
    },
  ): Promise<LedgerEntry> {
    return tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.REFUND,
        amount: data.amount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        commissionPercentApplied: null,
      },
    });
  }

  // ---- platform-admin (GOS-109) — `adminLedgerEntries`
  // (`src/platform-admin/ledger/`).

  private buildAdminFilter(
    filter?: AdminLedgerEntriesFilter,
  ): Prisma.LedgerEntryWhereInput {
    if (!filter) {
      return {};
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (filter.from) {
      createdAt.gte = filter.from;
    }
    if (filter.to) {
      createdAt.lte = filter.to;
    }
    return {
      engagementId: filter.engagementId,
      professionalProfileId: filter.professionalProfileId,
      createdAt: filter.from || filter.to ? createdAt : undefined,
    };
  }

  findManyForAdmin(
    filter: AdminLedgerEntriesFilter | undefined,
    limit: number,
    offset: number,
  ): Promise<LedgerEntry[]> {
    return this.prisma.ledgerEntry.findMany({
      where: this.buildAdminFilter(filter),
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  countForAdmin(filter?: AdminLedgerEntriesFilter): Promise<number> {
    return this.prisma.ledgerEntry.count({
      where: this.buildAdminFilter(filter),
    });
  }
}
