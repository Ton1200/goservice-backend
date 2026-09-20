import { Injectable } from '@nestjs/common';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentAttemptType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProviderTransactionDetails } from './ports/payment-provider.port';

export interface AdminPaymentAttemptsFilter {
  engagementId?: string;
  // Only rows NOT (yet) settled — PENDING or REJECTED. A row that IS
  // APPROVED already surfaces in `adminEngagementPaymentSummaries` too (it
  // has ledger entries by then) — this filter is what lets an admin see the
  // in-flight/failed cases that view alone can never show. Named
  // `onlyPending` for continuity with the pre-generalization admin filter
  // (GOS-87); it now spans every method, not only cash.
  onlyPending?: boolean;
}

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `PaymentAttempt` — same data-ownership rule as `LedgerRepository`/
 * `EngagementsRepository`. `src/payments/` never writes the `Engagement`
 * table directly (that stays `EngagementsRepository`'s job — see its
 * `setPaymentMethodIfUnset`) nor the `LedgerEntry` table (that stays
 * `LedgerRepository`'s, via `RecordDigitalPaymentService`/
 * `RecordCashCommissionDebtService`).
 *
 * Every payment, whatever its method, is ONE `PaymentAttempt` row
 * (2026-09-18 product decision — see that model's own schema comment):
 * digital attempts (`createPending` below) get a NEW row per try; a cash
 * attempt is ONE row per Engagement, upserted by `upsertCashConfirmation`
 * as each party confirms, then flipped APPROVED by the SAME
 * `resolveIfPending` CAS a digital attempt uses.
 */
@Injectable()
export class PaymentAttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts a new DIGITAL attempt in PENDING. The partial unique index
   * `PaymentAttempt_engagementId_active_key` makes this the atomic "no
   * double payment, no mixed method" guard: if the Engagement already has a
   * PENDING or APPROVED attempt of ANY method (including a cash confirmation
   * awaiting its second party) this throws Prisma's `P2002`, which the
   * caller translates into `CARD_PAYMENT_ALREADY_IN_PROGRESS` or
   * `PAYMENT_METHOD_CONFLICT`. Deliberately its own short, single statement
   * — committed BEFORE the provider is contacted, so no database transaction
   * is ever held open across an HTTP call.
   */
  createPending(data: {
    engagementId: string;
    amount: number;
    currency: string;
    installments: number;
  }): Promise<PaymentAttempt> {
    return this.prisma.paymentAttempt.create({
      data: {
        ...data,
        method: PaymentMethod.MERCADOPAGO,
        status: PaymentAttemptStatus.PENDING,
      },
    });
  }

  /**
   * The cash side of "one row per Engagement, upserted as each party
   * confirms" — a hand-written `INSERT ... ON CONFLICT` because the target
   * is the SAME partial unique index `createPending` relies on (Prisma's
   * schema language cannot declare a partial index, so its query builder
   * cannot target one either). The FIRST call from either party inserts the
   * row (`method: CASH`, `type: CASH`, PENDING, `amount`/`currency` frozen
   * from the caller's billing-context read); every later call from either
   * role just re-stamps ITS OWN confirmation column — never the other
   * party's, and never `amount`/`currency`/`status` — via the `DO UPDATE`
   * branch. A concurrent digital attempt (or a second cash confirmation
   * racing this one) that already holds the active slot makes the `INSERT`
   * violate the SAME index → a unique-constraint error, which the caller
   * turns into `PAYMENT_METHOD_CONFLICT`.
   *
   * The conflict target (`engagementId` where status is active) matches
   * ANY method, not only cash — a concurrent digital attempt on the same
   * Engagement is a conflict too. `DO UPDATE ... WHERE method = 'CASH'` is
   * what tells the two apart WITHOUT corrupting the wrong row: if the row
   * that conflicts is a digital one, that `WHERE` is false, Postgres skips
   * updating it, and the statement returns ZERO rows (not an error, not a
   * write) — a plain `INSERT ... ON CONFLICT DO UPDATE` with no such guard
   * would instead silently stamp a confirmation timestamp onto a card
   * attempt, verified live against this exact index before this guard was
   * added. An empty result is the caller's `PAYMENT_METHOD_CONFLICT` signal.
   *
   * Runs inside the caller's `tx` — same "externally-opened transaction"
   * idiom every other write method here follows.
   */
  async upsertCashConfirmation(
    tx: Prisma.TransactionClient,
    params: {
      engagementId: string;
      amount: number;
      currency: string;
      role: 'CUSTOMER' | 'PROFESSIONAL';
    },
  ): Promise<PaymentAttempt | null> {
    const stampColumn =
      params.role === 'CUSTOMER'
        ? 'customerConfirmedAt'
        : 'professionalConfirmedAt';
    const rows = await tx.$queryRaw<PaymentAttempt[]>`
      INSERT INTO "PaymentAttempt"
        ("id", "engagementId", "method", "type", "status", "amount", "currency", "installments", ${Prisma.raw(`"${stampColumn}"`)}, "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${params.engagementId}::uuid, 'CASH'::"PaymentMethod", 'CASH'::"PaymentAttemptType", 'PENDING'::"PaymentAttemptStatus", ${params.amount}, ${params.currency}, 1, now(), now(), now())
      ON CONFLICT ("engagementId") WHERE "status" IN ('PENDING', 'APPROVED')
      DO UPDATE SET ${Prisma.raw(`"${stampColumn}"`)} = now(), "updatedAt" = now()
      WHERE "PaymentAttempt"."method" = 'CASH'
      RETURNING *;
    `;
    return rows[0] ?? null;
  }

  /**
   * Guarded CAS — the mechanism that makes resolving an attempt idempotent,
   * whatever its method: flips `PENDING -> APPROVED|REJECTED` ONLY if the
   * attempt is still PENDING. For a digital attempt this is driven by the
   * provider's answer; for a cash attempt the caller invokes this with
   * `status: 'APPROVED'` the instant BOTH confirmation columns are set (a
   * cash attempt is never REJECTED — there is no reject flow for a hand-to-
   * hand payment). `count !== 1` means it was already resolved (by the
   * synchronous answer, an earlier/concurrent notification, or — for cash —
   * a concurrent confirmation that already saw both dates set), and the
   * caller must NOT write a second ledger event. Runs inside the caller's
   * `tx`, so the flip and its ledger writes commit or roll back together.
   */
  resolveIfPending(
    tx: Prisma.TransactionClient,
    id: string,
    resolution: {
      status: 'APPROVED' | 'REJECTED';
      providerPaymentId: string | null;
      rejectionReason: string | null;
      /**
       * The non-sensitive facts of how it was paid, when the provider could
       * report them (APPROVED only, digital). Written in the SAME statement
       * as the status flip, so they are never present on a PENDING attempt
       * and never lost on the winning side of a race. Left undefined for
       * cash — it has no provider facts to attach.
       */
      details?: ProviderTransactionDetails | null;
    },
  ): Promise<{ count: number }> {
    const details = resolution.details;
    return tx.paymentAttempt.updateMany({
      where: { id, status: PaymentAttemptStatus.PENDING },
      data: {
        status: resolution.status,
        rejectionReason: resolution.rejectionReason,
        // Never blank out a providerPaymentId that is already recorded.
        ...(resolution.providerPaymentId
          ? { providerPaymentId: resolution.providerPaymentId }
          : {}),
        ...(details
          ? {
              type: mapPaymentTypeIdToAttemptType(details.paymentTypeId),
              cardBrand: details.cardBrand,
              cardLastFour: details.cardLastFour,
              providerFeeAmount: details.providerFeeAmount,
              providerTaxAmount: details.providerTaxAmount,
              netReceivedAmount: details.netReceivedAmount,
              providerApprovedAt: details.approvedAt,
              moneyReleaseAt: details.moneyReleaseAt,
              paymentTypeId: details.paymentTypeId,
            }
          : {}),
      },
    });
  }

  /**
   * Records the provider's id on a STILL-PENDING attempt (the provider
   * answered `pending`, so the attempt stays open, but a later notification
   * needs the id to find it). No-op once resolved, and never overwrites an id
   * that is already there.
   */
  attachProviderPaymentIdIfPending(
    id: string,
    providerPaymentId: string,
  ): Promise<{ count: number }> {
    return this.prisma.paymentAttempt.updateMany({
      where: {
        id,
        status: PaymentAttemptStatus.PENDING,
        providerPaymentId: null,
      },
      data: { providerPaymentId },
    });
  }

  findById(id: string): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findUnique({ where: { id } });
  }

  /** The attempt a provider notification refers to, by the provider's own id. */
  findByProviderPaymentId(
    providerPaymentId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: { providerPaymentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The Engagement's still-PENDING attempt that has NO provider id yet — the
   * lost-response case (the create call timed out with an unknown outcome, so
   * the id was never recorded). The provider echoes `external_reference` =
   * `Engagement.id`, which is how a notification finds this attempt anyway.
   */
  findPendingWithoutProviderIdByEngagementId(
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: {
        engagementId,
        status: PaymentAttemptStatus.PENDING,
        providerPaymentId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The Engagement's cash attempt, whatever its state — `null` if neither
   * party has confirmed cash for it yet. `GetMyCashPaymentConfirmationService`'s
   * read model derives its three booleans from this row.
   */
  findCashAttemptByEngagementId(
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: { engagementId, method: PaymentMethod.CASH },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The ONE attempt that was ever approved for this Engagement, if any —
   * `null` for a job never paid (e.g. it was cancelled before any payment).
   * Reliable by construction, not just "usually right": once an attempt
   * reaches APPROVED it keeps occupying the partial unique index's active
   * slot FOREVER (APPROVED is one of the two statuses that index matches),
   * so no second attempt of ANY method can ever be created for the same
   * Engagement again — at most one row can ever be APPROVED. Used by
   * `adminEngagementPaymentSummaries` to attach the rich payment detail
   * (brand, last 4, cash confirmations…) to the job's own summary row,
   * without a `LedgerEntry -> PaymentAttempt` FK.
   */
  findApprovedByEngagementId(
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: { engagementId, status: PaymentAttemptStatus.APPROVED },
    });
  }

  /**
   * GOS-142 — the Engagement's MOST RECENT attempt, whatever its method or
   * status — `null` if none exists yet. `myEngagementPaymentAttempt`'s own
   * read model: unlike `findActiveByEngagementId` (PENDING/APPROVED only),
   * this also returns a REJECTED attempt, so the Customer can see a wallet
   * payment that failed and be told to retry — the whole reason this read
   * exists.
   */
  findLatestByEngagementId(
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The Engagement's currently ACTIVE attempt (PENDING or APPROVED),
   * whatever its method — `null` if none. Used to tell a genuine
   * `CARD_PAYMENT_ALREADY_IN_PROGRESS` apart from a `PAYMENT_METHOD_CONFLICT`
   * AFTER the partial unique index has already rejected a write: at that
   * point the caller's own in-memory `Engagement` read is stale by
   * definition (something else won the race since), so which method
   * actually holds the slot can only be answered by reading it fresh.
   */
  findActiveByEngagementId(
    engagementId: string,
  ): Promise<PaymentAttempt | null> {
    return this.prisma.paymentAttempt.findFirst({
      where: {
        engagementId,
        status: {
          in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.APPROVED],
        },
      },
    });
  }

  // ---- platform-admin — `adminPaymentAttempts` (`src/platform-admin/`).

  private buildAdminFilter(
    filter?: AdminPaymentAttemptsFilter,
  ): Prisma.PaymentAttemptWhereInput {
    if (!filter) {
      return {};
    }
    return {
      engagementId: filter.engagementId,
      ...(filter.onlyPending
        ? {
            status: {
              in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.REJECTED],
            },
          }
        : {}),
    };
  }

  findManyForAdmin(
    filter: AdminPaymentAttemptsFilter | undefined,
    limit: number,
    offset: number,
  ): Promise<PaymentAttempt[]> {
    return this.prisma.paymentAttempt.findMany({
      where: this.buildAdminFilter(filter),
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  countForAdmin(filter?: AdminPaymentAttemptsFilter): Promise<number> {
    return this.prisma.paymentAttempt.count({
      where: this.buildAdminFilter(filter),
    });
  }
}

/** Mirrors `resolveMercadoPagoPaymentType`'s vocabulary — mapped from the
 * provider's raw `payment_type_id` into the stable `PaymentAttemptType`. */
function mapPaymentTypeIdToAttemptType(
  paymentTypeId: string | null | undefined,
): PaymentAttemptType | undefined {
  switch (paymentTypeId) {
    case 'credit_card':
      return PaymentAttemptType.CREDIT_CARD;
    case 'debit_card':
      return PaymentAttemptType.DEBIT_CARD;
    case 'account_money':
      return PaymentAttemptType.ACCOUNT_MONEY;
    default:
      return undefined;
  }
}
