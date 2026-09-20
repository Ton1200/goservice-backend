import { Field, ObjectType } from '@nestjs/graphql';
import { PaymentAttemptModel } from './payment-attempt.model';

/**
 * `startEngagementWalletPayment`'s return type — a small wrapper, NOT a field
 * bolted onto the shared, reused-everywhere `PaymentAttemptModel` (same
 * pattern `AdminLoginPayload`/`AcceptAdminInvitePayload` already establish
 * for "a mutation returns two logically-related-but-distinct pieces of
 * data"). `redirectUrl` only exists at the instant a wallet checkout is
 * started — it has no business being loaded on every OTHER place a
 * `PaymentAttempt` is returned (a receipt, an admin list, a later
 * `myEngagementPaymentAttempt` read of the same row).
 */
@ObjectType()
export class StartWalletPaymentPayload {
  @Field(() => PaymentAttemptModel)
  attempt!: PaymentAttemptModel;

  @Field({
    description:
      "The URL to open so the Customer can pick, inside their OWN Mercado Pago account, whether to pay with account balance or a saved card, then return to the app. Sandbox or production, matching the credential this Engagement's country is configured with.",
  })
  redirectUrl!: string;
}
