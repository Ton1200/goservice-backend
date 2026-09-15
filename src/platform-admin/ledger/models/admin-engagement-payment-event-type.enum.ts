import { registerEnumType } from '@nestjs/graphql';

/**
 * 2026-09-14 follow-up (human-requested) — classifies WHICH financial event
 * a given `AdminEngagementPaymentSummary` row represents, derived (never
 * stored) from which `LedgerEntryType`s appear in that event's own
 * `LedgerEntry` group — see `ListAdminEngagementPaymentSummariesService`'s
 * own `classifyEvent` for the exact derivation rule. A GraphQL-only concept,
 * no matching Prisma enum — this is a presentation-layer classification of
 * data already fully described by `LedgerEntryType`, not a new persisted
 * fact.
 */
export enum AdminEngagementPaymentEventType {
  // The Professional collected 100% of the price in cash, outside GoService
  // — both parties confirmed, so the platform's CASH_COMMISSION_DEBT was
  // recorded (GOS-87).
  CASH_PAYMENT = 'CASH_PAYMENT',
  // The Customer cancelled an Engagement that was already IN_PROGRESS — a
  // cancellation fee was charged and split between GoService and the
  // Professional (DEC-008).
  CUSTOMER_CANCELLATION = 'CUSTOMER_CANCELLATION',
  // The Professional cancelled — the Customer was refunded in full, no
  // charge to anyone (DEC-008).
  PROFESSIONAL_CANCELLATION = 'PROFESSIONAL_CANCELLATION',
  // RESERVED — a completed job paid digitally (CUSTOMER_CHARGE). No writer
  // exists yet (GOS-79/80); included now so this enum needs no breaking
  // change once that capability ships.
  DIGITAL_PAYMENT = 'DIGITAL_PAYMENT',
}

registerEnumType(AdminEngagementPaymentEventType, {
  name: 'AdminEngagementPaymentEventType',
  description:
    'Which kind of financial event this payment summary represents, derived from which LedgerEntryType rows it groups. DIGITAL_PAYMENT is reserved — no writer exists yet (GOS-79/80).',
});
