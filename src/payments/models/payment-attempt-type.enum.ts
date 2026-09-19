import { registerEnumType } from '@nestjs/graphql';
import { PaymentAttemptType } from '@prisma/client';

/**
 * Registers the Prisma-generated `PaymentAttemptType` enum as a GraphQL enum
 * type — HOW the Customer paid inside a method (`PaymentMethod` says WHO
 * collected). Follows Mercado Pago's own `payment_type_id` vocabulary
 * (`credit_card`, `debit_card`, `account_money`), plus `CASH`.
 */
registerEnumType(PaymentAttemptType, {
  name: 'PaymentAttemptType',
  description:
    'HOW the Customer paid inside a method: CASH, CREDIT_CARD, DEBIT_CARD, or ACCOUNT_MONEY (a Mercado Pago wallet payment — reserved, not available yet). Null until known: a card payment tells credit/debit apart only once the provider confirms it, and a wallet payment only once the provider reports which instrument was actually used.',
});

export { PaymentAttemptType };
