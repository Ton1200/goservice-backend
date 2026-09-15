import { registerEnumType } from '@nestjs/graphql';
import { PaymentMethod } from '@prisma/client';

/**
 * Registers the Prisma-generated `PaymentMethod` enum as a GraphQL enum type
 * — 2026-09-14 follow-up, its first GraphQL exposure (`Engagement.paymentMethod`
 * itself is still not exposed on the consumer schema, see that field's own
 * schema comment; this is admin-only, via `AdminEngagementPaymentSummary.paymentMethod`).
 * `CARD` is RESERVED — no writer exists for it yet (GOS-79).
 */
registerEnumType(PaymentMethod, {
  name: 'PaymentMethod',
  description:
    'Which payment method an Engagement is/was using. CASH is real (GOS-87); CARD is reserved for a future digital-payment capability (GOS-79) — no writer exists for it yet.',
});

export { PaymentMethod };
