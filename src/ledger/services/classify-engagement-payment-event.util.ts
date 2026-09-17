import { LedgerEntry, LedgerEntryType } from '@prisma/client';

/**
 * GOS-130 follow-up — a schema-agnostic classification of which financial
 * event a group of `LedgerEntry` rows (all sharing one Engagement and one
 * `createdAt`, i.e. one `prisma.$transaction`) represents. Deliberately a
 * plain string union, not a GraphQL enum — this module (`src/ledger/`) is
 * resolver-free and must stay presentation-layer-agnostic; BOTH
 * `AdminEngagementPaymentEventType` (`src/platform-admin/ledger/`) and
 * `EngagementPaymentEventType` (`src/engagement-financial-summary/`) are
 * separately-registered GraphQL enums whose string values happen to match
 * this union exactly, mapped at their own call sites.
 */
export type EngagementPaymentEventKind =
  | 'CASH_PAYMENT'
  | 'CUSTOMER_CANCELLATION'
  | 'PROFESSIONAL_CANCELLATION'
  | 'DIGITAL_PAYMENT';

export interface ClassifiedLedgerEvent {
  eventType: EngagementPaymentEventKind;
  totalPaidByCustomer: number;
  platformCommission: number;
  professionalNetAmount: number;
  cashCommissionDebtAmount: number;
}

/**
 * Moved verbatim out of `ListAdminEngagementPaymentSummariesService`
 * (2026-09-14 follow-up) — the one place that finds a specific
 * `LedgerEntryType` row within one event's group of rows. Typed against
 * plain `LedgerEntry` — every richer row shape this codebase passes here
 * (e.g. `AdminPaymentSummaryLedgerRow`) is a structural superset, so it's
 * accepted without a generic.
 */
export function findByType(
  rows: LedgerEntry[],
  type: LedgerEntryType,
): LedgerEntry | undefined {
  return rows.find((row) => row.type === type);
}

/**
 * The one place that decides, per event group, which `EngagementPaymentEventKind`
 * it is and how to compute `totalPaidByCustomer`/`platformCommission`/
 * `professionalNetAmount` — moved verbatim out of
 * `ListAdminEngagementPaymentSummariesService.toSummaryModel` (2026-09-14
 * follow-up), minus the GraphQL model assembly and the admin-only pending-
 * cash-debt lookup, which stay call-site concerns. See each branch's own
 * comment (originally on that method) for the business rule it mirrors
 * (DEC-008 for cancellations, GOS-87 for cash).
 */
export function classifyLedgerEventRows(
  rows: LedgerEntry[],
  quotedPrice: number,
): ClassifiedLedgerEvent {
  const cashDebt = findByType(rows, LedgerEntryType.CASH_COMMISSION_DEBT);
  const cancellationFee = findByType(
    rows,
    LedgerEntryType.CUSTOMER_CANCELLATION_FEE,
  );
  const refund = findByType(rows, LedgerEntryType.REFUND);
  const digitalCharge = findByType(rows, LedgerEntryType.CUSTOMER_CHARGE);

  if (cashDebt) {
    // GOS-87 — the Professional collected the FULL quoted price directly
    // from the Customer, in cash; GoService's own cut is exactly the
    // CASH_COMMISSION_DEBT amount, never independently re-derived from it
    // (rounding could disagree) — the source of truth for the full price is
    // the Quote itself, passed in as `quotedPrice`.
    return {
      eventType: 'CASH_PAYMENT',
      totalPaidByCustomer: quotedPrice,
      platformCommission: cashDebt.amount,
      professionalNetAmount: quotedPrice - cashDebt.amount,
      cashCommissionDebtAmount: cashDebt.amount,
    };
  }

  if (cancellationFee) {
    // DEC-008 point 5 — the cancellation FEE (not the full job price, which
    // was never fully paid since the work was never completed) is split
    // between GoService and the Professional exactly like a normal
    // completed-job commission would be.
    const platformCommission = findByType(
      rows,
      LedgerEntryType.PLATFORM_COMMISSION,
    );
    const professionalNet = findByType(
      rows,
      LedgerEntryType.PROFESSIONAL_NET_CREDIT,
    );
    return {
      eventType: 'CUSTOMER_CANCELLATION',
      totalPaidByCustomer: Math.abs(cancellationFee.amount),
      platformCommission: platformCommission?.amount ?? 0,
      professionalNetAmount: professionalNet?.amount ?? 0,
      cashCommissionDebtAmount: 0,
    };
  }

  if (refund) {
    // DEC-008 — "unaffected by this DEC ... full refund to the Customer, no
    // charge": net paid by the Customer for this job is 0, nothing is
    // split. (The actual refunded amount is still available to a caller
    // that needs it — via `findByType(rows, LedgerEntryType.REFUND)` — this
    // classification intentionally reports 0 here, same as the admin
    // summary it was moved out of.)
    return {
      eventType: 'PROFESSIONAL_CANCELLATION',
      totalPaidByCustomer: 0,
      platformCommission: 0,
      professionalNetAmount: 0,
      cashCommissionDebtAmount: 0,
    };
  }

  // RESERVED branch — no writer exists for CUSTOMER_CHARGE yet (GOS-79/80),
  // included so callers need no shape change once it does. `amount` is
  // treated as the full price paid; commission/net are left at 0 rather
  // than guessed, since the real split rule for a digital payment isn't
  // decided/built yet.
  return {
    eventType: 'DIGITAL_PAYMENT',
    totalPaidByCustomer: digitalCharge?.amount ?? 0,
    platformCommission: 0,
    professionalNetAmount: 0,
    cashCommissionDebtAmount: 0,
  };
}

/**
 * GOS-130 follow-up — narrows an Engagement's flat, most-recent-first
 * `LedgerEntry` rows down to "the rows belonging to the single most recent
 * financial event": every row sharing the exact same `createdAt` as
 * `rows[0]` (every `LedgerEntry` written inside the SAME
 * `prisma.$transaction` shares the exact same `createdAt` — see
 * `LedgerRepository.findManyForAdminPaymentSummaries`'s own comment for why
 * this is a reliable grouping key).
 *
 * **Documented, revisitable assumption**: this deliberately does NOT
 * aggregate across an Engagement's whole life — only its most recent event.
 * Valid today because a terminal financial event (cash-confirm, customer
 * cancellation, or professional cancellation/refund) can currently only
 * happen once per Engagement; would need to change if that ever stops being
 * true (e.g. a future dispute/adjustment flow that writes a second event
 * after the first).
 */
export function selectMostRecentLedgerEventRows(
  rows: LedgerEntry[],
): LedgerEntry[] {
  if (rows.length === 0) {
    return [];
  }
  const mostRecentCreatedAt = rows[0].createdAt.getTime();
  return rows.filter((row) => row.createdAt.getTime() === mostRecentCreatedAt);
}
