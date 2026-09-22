import { registerEnumType } from '@nestjs/graphql';
import { PaymentMethod } from '@prisma/client';

/**
 * Registers the Prisma-generated `PaymentMethod` enum as a GraphQL enum type
 * — 2026-09-14 follow-up, its first GraphQL exposure (`Engagement.paymentMethod`
 * itself is still not exposed on the consumer schema, see that field's own
 * schema comment; this is admin-only, via `AdminEngagementPaymentSummary.paymentMethod`
 * and `AdminPaymentAttempt.method`). `CASH` (GOS-87), `MERCADOPAGO`
 * (GOS-85) and `RAPYD` (GOS-146, the embedded-checkout card provider) are all
 * real, written values today. `MERCADOPAGO` replaced the
 * originally-reserved `CARD` (2026-09-18): the method names the collector
 * (who the money goes to/through), not the instrument used, since a Mercado
 * Pago wallet payment is not a card — see `PaymentAttempt`'s own schema
 * comment for the full generalization rationale.
 */
registerEnumType(PaymentMethod, {
  name: 'PaymentMethod',
  description:
    'Which payment method an Engagement is/was using — the COLLECTOR, not the instrument (see PaymentAttemptType for HOW, e.g. credit card vs account money). CASH (GOS-87), MERCADOPAGO (GOS-85) and RAPYD (GOS-146) are all real. A future provider adds a new value here.',
});

export { PaymentMethod };
