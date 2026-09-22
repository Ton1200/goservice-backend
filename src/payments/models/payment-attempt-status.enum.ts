import { registerEnumType } from '@nestjs/graphql';
import { PaymentAttemptStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `PaymentAttemptStatus` enum as a GraphQL
 * enum type — same pattern as `src/ledger/models/payment-method.enum.ts`.
 * `PENDING` is the only non-terminal state: the provider has not given a final
 * answer yet (e.g. a 3DS challenge), and a later notification will resolve it.
 */
registerEnumType(PaymentAttemptStatus, {
  name: 'PaymentAttemptStatus',
  description:
    'Outcome of one digital-payment attempt. PENDING: the payment provider has not given a final answer yet (it will be resolved by its asynchronous notification). APPROVED: charged. REJECTED: not charged — see rejectionReason.',
});

export { PaymentAttemptStatus };
