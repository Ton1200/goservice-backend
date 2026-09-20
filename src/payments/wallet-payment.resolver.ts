import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { MercadoPagoWalletModuleEnabledGuard } from './guards/mercadopago-wallet-module-enabled.guard';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { StartWalletPaymentPayload } from './models/start-wallet-payment-payload.model';
import { GetMyEngagementPaymentAttemptService } from './services/get-my-engagement-payment-attempt.service';
import { StartEngagementWalletPaymentService } from './services/start-engagement-wallet-payment.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `CardPaymentResolver` (deliberately NOT added to it — see the GOS-142
 * plan). `startEngagementWalletPayment` requires `SessionGuard` +
 * `AccountApprovedGuard` + `MercadoPagoWalletModuleEnabledGuard`, in that
 * exact order. `myEngagementPaymentAttempt` deliberately does NOT get the
 * module-enabled guard — see that guard's own header comment (same reasoning
 * `myPendingCashCommissionDebt`/`myCashPaymentConfirmation` already
 * establish: a read of already-existing data). Neither operation accepts a
 * `customerProfileId`/`userId` argument — ownership is always derived from
 * the session, server-side.
 */
@Resolver()
export class WalletPaymentResolver {
  constructor(
    private readonly startEngagementWalletPaymentService: StartEngagementWalletPaymentService,
    private readonly getMyEngagementPaymentAttemptService: GetMyEngagementPaymentAttemptService,
  ) {}

  @UseGuards(
    SessionGuard,
    AccountApprovedGuard,
    MercadoPagoWalletModuleEnabledGuard,
  )
  @Mutation(() => StartWalletPaymentPayload, {
    description:
      "Starts a Mercado Pago WALLET payment for an Engagement: the Customer is redirected to their OWN Mercado Pago account to choose between their account balance or a saved card inside it, then returns to the app. Only the Engagement's own Customer can call it, and only while it is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION or COMPLETED. The amount and currency are derived server-side from the accepted Quote — never sent by the client. Returns the created attempt (always PENDING — a wallet payment never resolves synchronously, unlike payEngagementWithCard) together with the redirectUrl to open. The attempt itself is resolved later, asynchronously, by Mercado Pago's notification — poll myEngagementPaymentAttempt after the redirect returns rather than assuming success. Rejects with WALLET_PAYMENT_ALREADY_IN_PROGRESS if the Engagement already has a PENDING or APPROVED attempt, or PAYMENT_METHOD_CONFLICT if it is already committed to CASH.",
  })
  async startEngagementWalletPayment(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<StartWalletPaymentPayload> {
    const result =
      await this.startEngagementWalletPaymentService.startEngagementWalletPayment(
        userId,
        { engagementId },
      );
    return { attempt: result.attempt, redirectUrl: result.redirectUrl };
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => PaymentAttemptModel, {
    nullable: true,
    description:
      "The Engagement's MOST RECENT payment attempt, whatever its method or status — null if none exists yet. Only the Engagement's own Customer may read it; anyone else (or a nonexistent Engagement) gets ENGAGEMENT_NOT_FOUND (anti-enumeration). If the latest attempt is still PENDING and a provider notification has already reached GoService at least once, this query opportunistically re-reads the provider's current state and applies it before answering — so reopening the app right after paying doesn't require waiting for the notification. That re-read is best-effort: any provider failure is swallowed, and the query still returns whatever is already persisted.",
  })
  myEngagementPaymentAttempt(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<PaymentAttemptModel | null> {
    return this.getMyEngagementPaymentAttemptService.getMyEngagementPaymentAttempt(
      userId,
      engagementId,
    );
  }
}
