import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { AvailablePaymentOptionModel } from './models/available-payment-option.model';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { AbandonEngagementPaymentAttemptService } from './services/abandon-engagement-payment-attempt.service';
import { GetAvailablePaymentMethodsService } from './services/get-available-payment-methods.service';

/**
 * Thin delivery adapter — no business logic here. Neither operation gets a
 * module-enabled guard, on purpose: `availablePaymentMethods` IS how the client
 * learns what is enabled, and `abandonEngagementPaymentAttempt` must work even
 * with a provider switched off (a Customer must always be able to free the
 * payment slot). Neither accepts a `customerProfileId`/`userId` argument —
 * ownership is always derived from the session, server-side.
 */
@Resolver()
export class PaymentOptionsResolver {
  constructor(
    private readonly getAvailablePaymentMethodsService: GetAvailablePaymentMethodsService,
    private readonly abandonEngagementPaymentAttemptService: AbandonEngagementPaymentAttemptService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [AvailablePaymentOptionModel], {
    description:
      "The ways the Engagement can be paid RIGHT NOW, so the client knows which flow to open (`kind`) — never deduce it from the provider's name. An option is listed only if its admin flag is ON and, for the digital ones, the Customer's own country has complete provider credentials. Only the Engagement's own Customer may read it; anyone else (or a nonexistent Engagement) gets ENGAGEMENT_NOT_FOUND. Empty when the Engagement is not payable (wrong status) or already paid. When it is committed to CASH only the CASH option is returned. When a digital attempt is still PENDING the options are STILL listed: read myEngagementPaymentAttempt to see it, and call abandonEngagementPaymentAttempt before switching to another provider.",
  })
  availablePaymentMethods(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<AvailablePaymentOptionModel[]> {
    return this.getAvailablePaymentMethodsService.getAvailablePaymentMethods(
      userId,
      engagementId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => PaymentAttemptModel, {
    description:
      "Frees the Engagement's payment slot when the Customer opened an embedded (Rapyd) checkout and walked away without paying, so they can pay another way. Only the Engagement's own Customer can call it. It ONLY works on the active, PENDING embedded-checkout attempt, and only after re-reading the provider confirms NO payment was created in it — the attempt then becomes REJECTED (rejectionReason ABANDONED). Rejects with PAYMENT_ATTEMPT_NOT_ABANDONABLE if there is no such attempt or a payment already exists inside it (money may have moved: the provider's own answer decides), and PAYMENT_CHECKOUT_UNAVAILABLE if the provider cannot be read right now (nothing is changed).",
  })
  abandonEngagementPaymentAttempt(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<PaymentAttemptModel> {
    return this.abandonEngagementPaymentAttemptService.abandonEngagementPaymentAttempt(
      userId,
      engagementId,
    );
  }
}
