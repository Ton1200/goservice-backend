import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { RapydSavedCardsEnabledGuard } from './guards/rapyd-saved-cards-enabled.guard';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { SavedCardModel } from './models/saved-card.model';
import { DeleteSavedCardService } from './services/delete-saved-card.service';
import { ListMySavedCardsService } from './services/list-my-saved-cards.service';
import { PayEngagementWithSavedCardService } from './services/pay-engagement-with-saved-card.service';

/**
 * Thin delivery adapter — no business logic here (GOS-146, Rapyd saved cards).
 * None of the operations accepts a `customerProfileId`/`userId`/amount/currency
 * argument: ownership comes from the session and the amount from the accepted
 * Quote, server-side. `mySavedCards` and `payEngagementWithSavedCard` sit behind
 * the saved-cards switch (`RapydSavedCardsEnabledGuard`: Rapyd ON + saved cards
 * ON); `deleteSavedCard` deliberately does not — a Customer can always erase a
 * stored card.
 */
@Resolver()
export class SavedCardResolver {
  constructor(
    private readonly listMySavedCardsService: ListMySavedCardsService,
    private readonly payEngagementWithSavedCardService: PayEngagementWithSavedCardService,
    private readonly deleteSavedCardService: DeleteSavedCardService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard, RapydSavedCardsEnabledGuard)
  @Query(() => [SavedCardModel], {
    description:
      "The caller's own saved Rapyd cards: brand, last four, type and expiry — never a card number or token. A card is saved by the Customer ticking \"Save card for future payments\" in Rapyd's widget while paying (startEngagementRapydCheckout links the checkout to the Customer when saved cards are on); it appears here the next time this is read. Rapyd's vault is the source of truth: every call re-syncs, and if Rapyd cannot be reached the last synced list is returned. Rejects with RAPYD_SAVED_CARDS_DISABLED / RAPYD_MODULE_DISABLED when the feature or Rapyd is switched off.",
  })
  async mySavedCards(@CurrentUser() userId: string): Promise<SavedCardModel[]> {
    return this.listMySavedCardsService.listMySavedCards(userId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard, RapydSavedCardsEnabledGuard)
  @Mutation(() => PaymentAttemptModel, {
    description:
      "Pays an Engagement with a saved card in ONE tap — no widget, no card data: the charge is made server-side with Rapyd's stored token while the Customer is in the app. Only the Engagement's own Customer can call it, with a card that is theirs, and only while the Engagement is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION or COMPLETED. The amount and currency are derived server-side from the accepted Quote. Returns the PaymentAttempt: APPROVED (the ledger is written), REJECTED (see rejectionReason — AUTHENTICATION_REQUIRED means the issuer wants 3D Secure: nothing was charged and the client should fall back to startEngagementRapydCheckout) or PENDING (Rapyd has not answered definitively; poll myEngagementPaymentAttempt). Rejects with SAVED_CARD_NOT_FOUND (not the caller's card), CARD_PAYMENT_ALREADY_IN_PROGRESS (another attempt, e.g. an open Rapyd checkout — abandonEngagementPaymentAttempt first — or already paid), PAYMENT_METHOD_CONFLICT (committed to CASH), PAYMENT_PROVIDER_NOT_CONFIGURED, PAYMENT_PROVIDER_UNAVAILABLE (outcome unknown; the attempt is left PENDING), RAPYD_SAVED_CARDS_DISABLED / RAPYD_MODULE_DISABLED.",
  })
  async payEngagementWithSavedCard(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('savedCardId', { type: () => ID }) savedCardId: string,
  ): Promise<PaymentAttemptModel> {
    return this.payEngagementWithSavedCardService.payEngagementWithSavedCard(
      userId,
      { engagementId, savedCardId },
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => Boolean, {
    description:
      "Erases one of the caller's saved cards — from Rapyd's vault first, then from GoService. Always available, even when the saved-cards feature is switched off. Returns true. Rejects with SAVED_CARD_NOT_FOUND when the card does not exist or is not the caller's, PAYMENT_PROVIDER_UNAVAILABLE when Rapyd could not be reached (nothing is deleted; retry).",
  })
  async deleteSavedCard(
    @CurrentUser() userId: string,
    @Args('savedCardId', { type: () => ID }) savedCardId: string,
  ): Promise<boolean> {
    await this.deleteSavedCardService.deleteSavedCard(userId, savedCardId);
    return true;
  }
}
