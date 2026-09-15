import { Injectable } from '@nestjs/common';
import { CashPaymentConfirmation, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashPaymentParty } from './cash-payment-access.service';

export interface AdminCashPaymentConfirmationsFilter {
  engagementId?: string;
  // Only rows where the OTHER party hasn't confirmed yet — i.e. NOT both
  // `customerConfirmedAt`/`professionalConfirmedAt` are set. A row that IS
  // fully confirmed already surfaces in `adminLedgerEntries` too (once its
  // `CASH_COMMISSION_DEBT` entry exists) — this filter is what lets an admin
  // see the half-confirmed cases that query alone can never show.
  onlyPending?: boolean;
}

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `CashPaymentConfirmation` — same data-ownership rule as
 * `EngagementsRepository`/`LedgerRepository` (see
 * goservice-docs/architecture/backend.md). `src/cash-payment/` never writes
 * the `Engagement` table directly — that stays `EngagementsRepository`'s own
 * job (see its `setPaymentMethodIfUnset`).
 *
 * `upsertConfirmation` takes an EXTERNALLY-opened `tx` — always called from
 * inside `ConfirmCashPaymentService`'s own `prisma.$transaction`, same idiom
 * as `LedgerRepository`'s own write methods.
 */
@Injectable()
export class CashPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent create-or-stamp: the FIRST call from either party creates the
   * row (via Postgres's own `INSERT ... ON CONFLICT`, what Prisma's `upsert`
   * compiles to for a single unique key — same atomic-and-safe-under-a-race
   * pattern `ProfilesRepository.upsertCustomerProfile`/
   * `EngagementChatConversation`'s own creation already establish for
   * "created transparently on first use"); every later call from the SAME
   * role just re-stamps its own timestamp column to `now()` — never an
   * error, matching this ticket's "confirming twice is a no-op" AC. Stamps
   * ONLY the calling role's own column — the other party's column (if any)
   * is left untouched by Prisma's partial `update`/`create` data shape.
   */
  upsertConfirmation(
    tx: Prisma.TransactionClient,
    engagementId: string,
    role: CashPaymentParty,
  ): Promise<CashPaymentConfirmation> {
    const now = new Date();
    const stamp =
      role === 'CUSTOMER'
        ? { customerConfirmedAt: now }
        : { professionalConfirmedAt: now };
    return tx.cashPaymentConfirmation.upsert({
      where: { engagementId },
      update: stamp,
      create: { engagementId, ...stamp },
    });
  }

  /**
   * Guarded CAS: flips `commissionDebtRecorded` `false -> true` ONLY if it
   * is still `false` for this `engagementId`. `count !== 1` means another
   * concurrent `confirmCashPayment` call already won this race (both
   * confirmations landed almost simultaneously) — the caller must NOT write
   * a second `CASH_COMMISSION_DEBT` `LedgerEntry` in that case. Same
   * "guarded CAS inside the caller's own transaction" idiom
   * `EngagementsRepository.cancelIfActive`/`completeIfPendingCustomerConfirmation`
   * already establish.
   */
  markCommissionDebtRecordedIfUnset(
    tx: Prisma.TransactionClient,
    engagementId: string,
  ): Promise<{ count: number }> {
    return tx.cashPaymentConfirmation.updateMany({
      where: { engagementId, commissionDebtRecorded: false },
      data: { commissionDebtRecorded: true },
    });
  }

  findByEngagementId(
    engagementId: string,
  ): Promise<CashPaymentConfirmation | null> {
    return this.prisma.cashPaymentConfirmation.findUnique({
      where: { engagementId },
    });
  }

  // ---- platform-admin (GOS-87) — `adminCashPaymentConfirmations`
  // (`src/platform-admin/cash-payment/`).

  private buildAdminFilter(
    filter?: AdminCashPaymentConfirmationsFilter,
  ): Prisma.CashPaymentConfirmationWhereInput {
    if (!filter) {
      return {};
    }
    return {
      engagementId: filter.engagementId,
      ...(filter.onlyPending
        ? {
            OR: [
              { customerConfirmedAt: null },
              { professionalConfirmedAt: null },
            ],
          }
        : {}),
    };
  }

  findManyForAdmin(
    filter: AdminCashPaymentConfirmationsFilter | undefined,
    limit: number,
    offset: number,
  ): Promise<CashPaymentConfirmation[]> {
    return this.prisma.cashPaymentConfirmation.findMany({
      where: this.buildAdminFilter(filter),
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  countForAdmin(filter?: AdminCashPaymentConfirmationsFilter): Promise<number> {
    return this.prisma.cashPaymentConfirmation.count({
      where: this.buildAdminFilter(filter),
    });
  }
}
