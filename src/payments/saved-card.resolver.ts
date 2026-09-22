import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { SavedCardModel } from './models/saved-card.model';
import { DeleteSavedCardService } from './services/delete-saved-card.service';
import { ListMySavedCardsService } from './services/list-my-saved-cards.service';
import { PayEngagementWithSavedCardService } from './services/pay-engagement-with-saved-card.service';

/**
 * Thin delivery adapter — no business logic here (GOS-146: Rapyd; GOS-149:
 * Mercado Pago — saved cards of EITHER provider). None of the operations
 * accepts a `customerProfileId`/`userId`/amount/currency argument: ownership
 * comes from the session and the amount from the accepted Quote,
 * server-side. `mySavedCards` and `payEngagementWithSavedCard` no longer sit
 * behind a single-provider blanket guard (GOS-149: this resolver now serves
 * more than one provider, so a per-CARD check replaces it — see
 * `ListMySavedCardsService.isSavedCardsEnabledFor` and
 * `PayEngagementWithSavedCardService.assertSavedCardsEnabledFor`);
 * `deleteSavedCard` deliberately never had a feature-switch guard — a
 * Customer can always erase a stored card.
 */
@Resolver()
export class SavedCardResolver {
  constructor(
    private readonly listMySavedCardsService: ListMySavedCardsService,
    private readonly payEngagementWithSavedCardService: PayEngagementWithSavedCardService,
    private readonly deleteSavedCardService: DeleteSavedCardService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [SavedCardModel], {
    description:
      "The caller's own saved cards, across every provider that currently supports them (RAPYD, one-tap; MERCADOPAGO, CVV re-entry required on every charge — see method): brand, last four, type and expiry — never a card number or token. A Rapyd card is saved by ticking \"Save card for future payments\" in Rapyd's widget while paying; a Mercado Pago card is saved by passing saveCard: true to payEngagementWithCard. Each provider's vault is the source of truth for its own cards: every call re-syncs, and if a provider cannot be reached its last synced list is returned. A provider whose saved-cards switch is off is silently excluded (not an error).",
  })
  async mySavedCards(@CurrentUser() userId: string): Promise<SavedCardModel[]> {
    return this.listMySavedCardsService.listMySavedCards(userId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => PaymentAttemptModel, {
    description:
      "Pays an Engagement with a saved card — of whatever provider it belongs to (see SavedCard.method). A Rapyd card charges in ONE tap, server-side, with no further input. A Mercado Pago card requires providerToken: the client re-tokenizes { card_id, security_code: <CVV the Customer just typed> } with Mercado Pago's own SDK immediately before calling this mutation (providerToken is ignored for a Rapyd card). Only the Engagement's own Customer can call it, with a card that is theirs, and only while the Engagement is IN_PROGRESS, PENDING_CUSTOMER_CONFIRMATION or COMPLETED. The amount and currency are derived server-side from the accepted Quote. Returns the PaymentAttempt: APPROVED (the ledger is written), REJECTED (see rejectionReason — AUTHENTICATION_REQUIRED means the issuer wants 3D Secure, Rapyd only: nothing was charged and the client should fall back to startEngagementRapydCheckout) or PENDING (the provider has not answered definitively; poll myEngagementPaymentAttempt). Rejects with SAVED_CARD_NOT_FOUND (not the caller's card), CARD_PAYMENT_ALREADY_IN_PROGRESS (another attempt in progress — abandonEngagementPaymentAttempt first — or already paid), PAYMENT_METHOD_CONFLICT (committed to CASH), PAYMENT_PROVIDER_NOT_CONFIGURED, PAYMENT_PROVIDER_UNAVAILABLE (outcome unknown; the attempt is left PENDING), RAPYD_SAVED_CARDS_DISABLED / RAPYD_MODULE_DISABLED / MERCADOPAGO_SAVED_CARDS_DISABLED / CARD_PAYMENT_MODULE_DISABLED.",
  })
  async payEngagementWithSavedCard(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
    @Args('savedCardId', { type: () => ID }) savedCardId: string,
    @Args('providerToken', { type: () => String, nullable: true })
    providerToken?: string,
  ): Promise<PaymentAttemptModel> {
    return this.payEngagementWithSavedCardService.payEngagementWithSavedCard(
      userId,
      { engagementId, savedCardId, providerToken },
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
