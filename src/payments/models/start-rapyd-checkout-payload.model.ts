import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * `startEngagementRapydCheckout`'s return type — deliberately its own small
 * wrapper (same pattern as `StartWalletPaymentPayload`), NOT a field bolted
 * onto the shared `PaymentAttemptModel`. There is NO `redirectUrl`: the
 * payment is completed INSIDE the app, in Rapyd's embedded Checkout Toolkit
 * widget, so the client needs only the checkout id and the script to load.
 */
@ObjectType()
export class StartRapydCheckoutPayload {
  @Field(() => ID, {
    description:
      'The GoService payment attempt this checkout belongs to (PENDING until Rapyd reports the payment). Poll `myEngagementPaymentAttempt` to learn its outcome.',
  })
  attemptId!: string;

  @Field({
    description:
      "Rapyd's checkout id (`checkout_…`) — pass it as `id` to `new RapydCheckoutToolkit({ id })`. Idempotent: restarting an unpaid, still-valid checkout returns the SAME id.",
  })
  checkoutId!: string;

  @Field({
    description:
      "The Rapyd Checkout Toolkit `<script>` URL to load — sandbox or production, matching this Engagement's country configuration. The widget renders in an element with id `rapyd-checkout`. The widget's own success/failure events are NOT the source of truth: confirm with `myEngagementPaymentAttempt`.",
  })
  toolkitScriptUrl!: string;
}
