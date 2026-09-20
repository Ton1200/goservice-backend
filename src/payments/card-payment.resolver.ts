import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { CardPaymentModuleEnabledGuard } from './guards/card-payment-module-enabled.guard';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { PayEngagementWithCardService } from './services/pay-engagement-with-card.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `CashPaymentResolver`. `payEngagementWithCard` requires `SessionGuard` +
 * `AccountApprovedGuard` + `CardPaymentModuleEnabledGuard`, in that exact
 * order. It accepts no `customerProfileId`/`userId`/amount/currency argument —
 * ownership is derived from the session and the amount from the accepted Quote,
 * server-side.
 */
@Resolver()
export class CardPaymentResolver {
  constructor(
    private readonly payEngagementWithCardService: PayEngagementWithCardService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, CardPaymentModuleEnabledGuard)
  @Mutation(() => PaymentAttemptModel, {
    description:
      'Pays an Engagement by card, with no redirect. Only the Engagement\'s own Customer can call it, and only while it is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION or COMPLETED. `cardToken` is the single-use token obtained by tokenizing the card CLIENT-SIDE with the payment provider — the card itself never touches GoService\'s servers; `paymentMethodId` is the card brand id that tokenization reported (e.g. "visa", "master" for credit; "debvisa", "debmaster" for DEBIT cards — the card type is derived from this id, there is no separate argument). A debit card has no instalments: `installments` must be 1, otherwise the attempt is REJECTED with INVALID_CARD_DATA and nothing is charged. The amount and currency are derived server-side from the accepted Quote — never sent by the client. Returns the attempt: APPROVED (charged), REJECTED (not charged — see rejectionReason; a declined card is a normal result, not an error) or PENDING (the provider has not given a final answer yet — it is resolved by its asynchronous notification; do not retry, a new attempt is rejected while one is PENDING). Rejects with CARD_PAYMENT_ALREADY_IN_PROGRESS if the Engagement already has a PENDING or APPROVED attempt.',
  })
  payEngagementWithCard(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('cardToken') cardToken: string,
    @Args('paymentMethodId') paymentMethodId: string,
    @Args('installments', { type: () => Int, defaultValue: 1 })
    installments: number,
  ): Promise<PaymentAttemptModel> {
    return this.payEngagementWithCardService.payEngagementWithCard(userId, {
      engagementId,
      cardToken,
      paymentMethodId,
      installments,
    });
  }
}
