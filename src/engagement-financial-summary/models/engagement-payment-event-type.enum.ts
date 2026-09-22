import { registerEnumType } from '@nestjs/graphql';

/**
 * GOS-130 follow-up — `EngagementFinancialSummary.eventType`'s own
 * classification of which financial event this Engagement's summary
 * reflects; `null` before any event has happened yet. A DELIBERATELY
 * SEPARATE, independent GraphQL enum from `AdminEngagementPaymentEventType`
 * (`src/platform-admin/ledger/`) — same "never reuse an Admin-prefixed type
 * on the public schema" discipline `PaymentReceiptModel`'s own header
 * comment (and ADR 0005's schema-isolation rationale) already establish,
 * even though the string values are identical today. Both this enum and
 * `AdminEngagementPaymentEventType` are mapped, at their own call sites,
 * from the SAME schema-agnostic `EngagementPaymentEventKind` union
 * (`src/ledger/services/classify-engagement-payment-event.util.ts`) — never
 * from each other.
 */
export enum EngagementPaymentEventType {
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
  // A job paid digitally, by card (CUSTOMER_CHARGE + PLATFORM_COMMISSION +
  // PROFESSIONAL_NET_CREDIT, written together when the charge is approved —
  // GOS-85). NOTE the Professional's net is an accounting credit in
  // GoService's own ledger; paying it out is a separate, later capability
  // (GOS-82/GOS-139).
  DIGITAL_PAYMENT = 'DIGITAL_PAYMENT',
}

registerEnumType(EngagementPaymentEventType, {
  name: 'EngagementPaymentEventType',
  description:
    'Which kind of financial event this Engagement’s financial summary reflects — null before any event has happened. DIGITAL_PAYMENT is a job paid by card (GOS-85).',
});
