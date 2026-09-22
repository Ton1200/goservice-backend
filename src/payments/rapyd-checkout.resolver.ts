import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { RapydModuleEnabledGuard } from './guards/rapyd-module-enabled.guard';
import { StartRapydCheckoutPayload } from './models/start-rapyd-checkout-payload.model';
import { StartEngagementRapydCheckoutService } from './services/start-engagement-rapyd-checkout.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `WalletPaymentResolver` (deliberately NOT added to it).
 * `startEngagementRapydCheckout` requires `SessionGuard` +
 * `AccountApprovedGuard` + `RapydModuleEnabledGuard`, in that exact order. It
 * accepts no `customerProfileId`/`userId`/amount/currency argument — ownership
 * is derived from the session and the amount from the accepted Quote,
 * server-side.
 */
@Resolver()
export class RapydCheckoutResolver {
  constructor(
    private readonly startEngagementRapydCheckoutService: StartEngagementRapydCheckoutService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, RapydModuleEnabledGuard)
  @Mutation(() => StartRapydCheckoutPayload, {
    description:
      "Starts a Rapyd card payment for an Engagement, completed INSIDE the app with Rapyd's embedded Checkout Toolkit — there is NO redirect. Only the Engagement's own Customer can call it, and only while it is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION or COMPLETED. The amount and currency are derived server-side from the accepted Quote — never sent by the client. Returns the attemptId, the Rapyd checkoutId and the toolkitScriptUrl to load; the card is typed into Rapyd's iframe and never touches GoService. The attempt stays PENDING until Rapyd's notification (or a later myEngagementPaymentAttempt) resolves it — the widget's own success event is NOT proof of payment. Idempotent: if the Engagement already has an unpaid, still-valid Rapyd checkout, the SAME checkoutId is returned; an expired one is replaced by a new attempt. Rejects with CARD_PAYMENT_ALREADY_IN_PROGRESS if another provider's attempt is active or the Engagement is already paid, PAYMENT_METHOD_CONFLICT if it is committed to CASH, PAYMENT_PROVIDER_NOT_CONFIGURED if Rapyd's credentials are missing or rejected, RAPYD_MODULE_DISABLED if Rapyd is switched off.",
  })
  async startEngagementRapydCheckout(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<StartRapydCheckoutPayload> {
    const result =
      await this.startEngagementRapydCheckoutService.startEngagementRapydCheckout(
        userId,
        { engagementId },
      );
    return {
      attemptId: result.attempt.id,
      checkoutId: result.checkoutId,
      toolkitScriptUrl: result.toolkitScriptUrl,
    };
  }
}
