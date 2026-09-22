import { registerEnumType } from '@nestjs/graphql';

/**
 * GOS-146 — WHICH FLOW the client must open for a payment option. The client
 * switches on this, never on the provider's name. `CASH` is hand-to-hand
 * (`confirmCashPayment`); the other three map 1:1 to a provider capability
 * (`payment-provider.port.ts`): `CARD_TOKEN` (tokenize the card client-side →
 * `payEngagementWithCard`), `WALLET_REDIRECT` (open the provider's own
 * account → `startEngagementWalletPayment`), `EMBEDDED_CHECKOUT` (load the
 * provider's widget in-app → `startEngagementRapydCheckout`).
 */
export enum PaymentOptionKind {
  CASH = 'CASH',
  CARD_TOKEN = 'CARD_TOKEN',
  WALLET_REDIRECT = 'WALLET_REDIRECT',
  EMBEDDED_CHECKOUT = 'EMBEDDED_CHECKOUT',
}

registerEnumType(PaymentOptionKind, {
  name: 'PaymentOptionKind',
  description:
    'Which flow the client opens for a payment option: CASH (confirmCashPayment), CARD_TOKEN (tokenize the card client-side, then payEngagementWithCard), WALLET_REDIRECT (redirect to the provider account, startEngagementWalletPayment) or EMBEDDED_CHECKOUT (load the provider widget in-app, startEngagementRapydCheckout).',
});
