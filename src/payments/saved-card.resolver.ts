import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { PaymentMethod, SavedPaymentCard } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { PaymentAttemptModel } from './models/payment-attempt.model';
import { SavedCardModel } from './models/saved-card.model';
import { AddSavedCardService } from './services/add-saved-card.service';
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
    private readonly addSavedCardService: AddSavedCardService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [SavedCardModel], {
    description:
      "The caller's own saved cards, across every provider that currently supports them (RAPYD, one-tap; MERCADOPAGO, CVV re-entry required on every charge — see method): brand, last four, type and expiry — never a card number or token. A Rapyd card is saved by ticking \"Save card for future payments\" in Rapyd's widget while paying; a Mercado Pago card is saved by passing saveCard: true to payEngagementWithCard, or directly with addSavedCard (GOS-150). Each provider's vault is the source of truth for its own cards: every call re-syncs, and if a provider cannot be reached its last synced list is returned. Mercado Pago cards are ALWAYS listed, even while its saved-cards switch is off (the switch governs saving and paying with a card, never seeing or erasing one you own — use availablePaymentMethods' CARD_TOKEN.supportsSavedCards to know whether they can be paid with). Rapyd cards are silently excluded while Rapyd's own switch is off (not an error).",
  })
  async mySavedCards(@CurrentUser() userId: string): Promise<SavedCardModel[]> {
    const cards = await this.listMySavedCardsService.listMySavedCards(userId);
    // Only a Mercado Pago card's id is exposed — see SavedCardModel.providerCardId.
    return cards.map(toSafeSavedCard);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => Boolean, {
    description:
      'GOS-150 — whether the caller can save a Mercado Pago card directly from "Mis tarjetas guardadas" right now (addSavedCard): true only for a Customer while the Mercado Pago card method AND its saved-cards switch are ON and their country has Mercado Pago credentials. Never an error. Seeing and erasing saved cards does not depend on it.',
  })
  async canAddSavedCard(@CurrentUser() userId: string): Promise<boolean> {
    return this.addSavedCardService.canAddSavedCard(userId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => SavedCardModel, {
    description:
      "GOS-150 — saves a Mercado Pago card WITHOUT a payment (card management only: no PaymentAttempt, no ledger entry, nothing charged or pre-authorized). cardToken is a fresh single-use token the client obtained by tokenizing the card with Mercado Pago's public key — the card number and CVV never reach GoService. Creates the caller's Mercado Pago customer on first use, associates the card, and returns it as mySavedCards would. Rejects with CUSTOMER_PROFILE_REQUIRED, CARD_PAYMENT_MODULE_DISABLED / MERCADOPAGO_SAVED_CARDS_DISABLED (see canAddSavedCard), INVALID_CARD_PAYMENT_INPUT (malformed token, or Mercado Pago refused it — tokenize again), PAYMENT_PROVIDER_NOT_CONFIGURED or PAYMENT_PROVIDER_UNAVAILABLE.",
  })
  async addSavedCard(
    @CurrentUser() userId: string,
    @Args('cardToken') cardToken: string,
  ): Promise<SavedCardModel> {
    return toSafeSavedCard(
      await this.addSavedCardService.addSavedCard(userId, cardToken),
    );
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

/** Only a Mercado Pago card's id is exposed — see SavedCardModel.providerCardId. */
function toSafeSavedCard(card: SavedPaymentCard): SavedCardModel {
  return {
    ...card,
    providerCardId:
      card.method === PaymentMethod.MERCADOPAGO ? card.providerCardId : null,
  };
}
