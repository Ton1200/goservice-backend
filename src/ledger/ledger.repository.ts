import { Injectable } from '@nestjs/common';
import { LedgerEntry, LedgerEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminLedgerEntriesFilter {
  engagementId?: string;
  professionalProfileId?: string;
  from?: Date;
  to?: Date;
}

// See `findManyForAdminPaymentSummaries`'s own comment for the phase-1
// scope boundary this bounds.
const ADMIN_PAYMENT_SUMMARY_RAW_FETCH_CAP = 500;

// The "relación de usuarios" `adminEngagementPaymentSummaries` needs on
// both sides — `id`/`user.id`/`user.email` for admin identification (same
// shape this codebase's other admin grids already establish, e.g.
// `AdminServiceRequestCustomerModel`/`AdminQuoteProfessionalModel`), plus
// the Quote's price for deriving `totalPaidByCustomer` on a cash-paid job
// (the ORIGINAL agreed price, never back-computed from a rounded commission
// amount).
const ADMIN_PAYMENT_SUMMARY_ENGAGEMENT_SELECT = {
  id: true,
  paymentMethod: true,
  quote: { select: { price: true, negotiatedPrice: true } },
  customerProfile: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      user: { select: { id: true, email: true } },
    },
  },
  professionalProfile: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      user: { select: { id: true, email: true } },
    },
  },
} satisfies Prisma.EngagementSelect;

export type AdminPaymentSummaryLedgerRow = Prisma.LedgerEntryGetPayload<{
  include: {
    engagement: { select: typeof ADMIN_PAYMENT_SUMMARY_ENGAGEMENT_SELECT };
  };
}>;

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
   *
   * **`createdAt` is set EXPLICITLY, once, and passed to all 3 `create`
   * calls — do not remove this and rely on the column's `@default(now())`
   * instead.** GOS-130 follow-up found (via a real e2e run, not a unit
   * test) that Prisma generates that default CLIENT-SIDE, per statement —
   * NOT as a `now()`/`CURRENT_TIMESTAMP` column default evaluated once by
   * Postgres for the whole transaction, contrary to what every downstream
   * "these rows are one financial event" grouping (`groupIntoEvents` in
   * `list-admin-engagement-payment-summaries.service.ts`,
   * `selectMostRecentLedgerEventRows` in
   * `classify-engagement-payment-event.util.ts`) had assumed and documented.
   * Three sequential `tx.ledgerEntry.create()` calls were observed a few
   * milliseconds apart — an explicit, shared value is the only correct fix,
   * not a wider tolerance window.
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
    const createdAt = new Date();
    const fee = await tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
        amount: -data.feeAmount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        professionalProfileId: data.professionalProfileId,
        commissionPercentApplied: data.commissionPercentApplied,
        createdAt,
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
        createdAt,
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
        createdAt,
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

  /**
   * GOS-87 — the single `CASH_COMMISSION_DEBT` entry written the instant
   * BOTH parties confirm a `CashPaymentConfirmation`. Written ALONE (never
   * alongside a `PLATFORM_COMMISSION`/`PROFESSIONAL_NET_CREDIT` split, unlike
   * `createCustomerCancellationChargeEntries` above) — the Professional
   * already collected 100% of the price directly from the Customer, in
   * cash, so there is nothing to split; this row IS the debt itself. Runs
   * inside the caller's own `tx` (`RecordCashCommissionDebtService`, from
   * inside `ConfirmCashPaymentService`'s transaction).
   */
  createCashCommissionDebtEntry(
    tx: Prisma.TransactionClient,
    data: {
      engagementId: string;
      currency: string;
      customerProfileId: string;
      professionalProfileId: string;
      amount: number;
      commissionPercentApplied: number;
    },
  ): Promise<LedgerEntry> {
    return tx.ledgerEntry.create({
      data: {
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        amount: data.amount,
        currency: data.currency,
        engagementId: data.engagementId,
        customerProfileId: data.customerProfileId,
        professionalProfileId: data.professionalProfileId,
        commissionPercentApplied: data.commissionPercentApplied,
      },
    });
  }

  /**
   * GOS-87 — `Query.myPendingCashCommissionDebt`: the sum of every
   * `CASH_COMMISSION_DEBT` entry ever written for the given
   * `professionalProfileId`. Scope of THIS story: sums ALL of them — there
   * is no "regularize"/automatic-discount-on-next-digital-charge mechanism
   * yet (both depend on GOS-79, not built); see this method's own callers
   * for that documented extension point. `_sum.amount` is `null` (not `0`)
   * when there are no matching rows — normalized to `0` here so callers
   * never have to null-check.
   */
  async sumCashCommissionDebtForProfessional(
    professionalProfileId: string,
  ): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: {
        type: LedgerEntryType.CASH_COMMISSION_DEBT,
        professionalProfileId,
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  /**
   * 2026-09-14 follow-up (human-requested) — `Query.myPaymentReceipts`
   * (`src/payment-receipts/`): every `LedgerEntry` where the caller appears
   * as EITHER `customerProfileId` OR `professionalProfileId` — a User may
   * hold both profile types, so both are checked, not just whichever one
   * resolved first. Ordered most-recent-first, same convention as every
   * other "my own list" query in this codebase
   * (`findManyByCustomerProfileId`/`findManyByProfessionalProfileId` on
   * `EngagementsRepository`).
   *
   * Deliberately returns EVERY `LedgerEntryType` the caller is denormalized
   * on, unfiltered by type — which specific types are appropriate to
   * surface to a Customer vs. a Professional (e.g. whether a Customer
   * should see `PLATFORM_COMMISSION`/`PROFESSIONAL_NET_CREDIT` rows from
   * their own cancellation-charge event) is a real UX/privacy question,
   * flagged as an open item for the consuming client (`goservice-mobile`)
   * to resolve — NOT decided here.
   */
  findManyForCallerProfiles(params: {
    customerProfileId?: string;
    professionalProfileId?: string;
  }): Promise<LedgerEntry[]> {
    const or: Prisma.LedgerEntryWhereInput[] = [];
    if (params.customerProfileId) {
      or.push({ customerProfileId: params.customerProfileId });
    }
    if (params.professionalProfileId) {
      or.push({ professionalProfileId: params.professionalProfileId });
    }
    if (or.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.ledgerEntry.findMany({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 2026-09-14 follow-up (human-requested) — `Query.adminEngagementPaymentSummaries`
   * (`src/platform-admin/ledger/`): the raw material for a ONE-ROW-PER-JOB
   * admin view, grouped downstream (in `ListAdminEngagementPaymentSummariesService`)
   * by `(engagementId, createdAt)` — every row written inside the SAME
   * `prisma.$transaction` shares the exact same `createdAt` (Postgres's
   * `now()` returns the transaction start time for every statement in one
   * transaction), so this pair is a reliable "these rows are one financial
   * event" key without a dedicated grouping table.
   *
   * **Documented phase-1 scope boundary**: fetches the `ADMIN_PAYMENT_SUMMARY_RAW_FETCH_CAP`
   * most recent rows, THEN groups/paginates in application code — not a true
   * DB-level distinct-pair pagination. Correct and simple for this
   * project's current data volume; would need a real grouping mechanism
   * (e.g. a `PaymentEvent` table) to stay correct at real scale. Same
   * "deliberate, documented" trade-off `DEFAULT_LIMIT`/`MAX_LIMIT` already
   * establish elsewhere in this admin surface.
   */
  findManyForAdminPaymentSummaries(): Promise<AdminPaymentSummaryLedgerRow[]> {
    return this.prisma.ledgerEntry.findMany({
      where: { engagementId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: ADMIN_PAYMENT_SUMMARY_RAW_FETCH_CAP,
      include: {
        engagement: { select: ADMIN_PAYMENT_SUMMARY_ENGAGEMENT_SELECT },
      },
    });
  }

  /**
   * GOS-130 follow-up — `Query.engagementFinancialSummary`
   * (`src/engagement-financial-summary/`): every `LedgerEntry` for ONE
   * Engagement, most-recent-first — the raw material
   * `selectMostRecentLedgerEventRows`
   * (`src/ledger/services/classify-engagement-payment-event.util.ts`)
   * narrows down to "the rows belonging to the single most recent
   * financial event". No `select`/`include` here — the Engagement/Quote
   * context that query also needs is fetched separately, by
   * `EngagementsRepository.findByIdWithFinancialSummaryContext`, from the
   * access-check service that runs BEFORE this — a join here would be
   * redundant, and for the common "no event yet" case this simply returns
   * `[]`.
   */
  findManyByEngagementId(engagementId: string): Promise<LedgerEntry[]> {
    return this.prisma.ledgerEntry.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
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
