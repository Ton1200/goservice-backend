import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import { savedCardNotFound } from '../errors/saved-card-not-found.error';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';

/**
 * Orchestrates `Mutation.deleteSavedCard`: the Customer erases one of their
 * saved cards, of WHATEVER provider it belongs to (GOS-146: Rapyd; GOS-149:
 * Mercado Pago) — from the provider's own vault FIRST, then from GoService's
 * table, so a failure never leaves a card that looks deleted but can still
 * be charged.
 *
 * - The card must belong to the caller's Customer profile; anything else is
 *   the anti-enumeration `SAVED_CARD_NOT_FOUND`.
 * - Every provider's delete is idempotent (a card the provider no longer
 *   knows is fine), so a retry after a partial failure completes cleanly.
 * - A card saved in ANOTHER environment than the one currently configured
 *   for its provider (a sandbox card after switching to production) cannot
 *   be removed from that provider with today's credentials; it is unusable
 *   anyway (charging only ever considers the current environment) and is
 *   removed locally, logged for an operator.
 * - Deliberately NOT behind either provider's saved-cards switch: a Customer
 *   can always erase their card, even after the feature was turned off.
 */
@Injectable()
export class DeleteSavedCardService {
  private readonly logger = new Logger(DeleteSavedCardService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly savedCardRepository: SavedCardRepository,
  ) {}

  async deleteSavedCard(userId: string, savedCardId: string): Promise<void> {
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    const card = profile
      ? await this.savedCardRepository.findCardOfCustomer(
          savedCardId,
          profile.id,
        )
      : null;
    if (!profile || !card) {
      throw savedCardNotFound();
    }

    // GOS-149 — derived from the CARD's own method, never hardcoded: this
    // service now erases a card of ANY provider that supports saved cards.
    const provider = this.paymentProviderRegistry.savedCards(card.method);
    const country =
      card.method === PaymentMethod.MERCADOPAGO ? profile.country : undefined;
    try {
      const environment = await provider.currentEnvironment(country);
      if (card.environment !== environment) {
        this.logger.warn({
          event: 'saved_card_deleted_locally_other_environment',
          savedCardId: card.id,
          method: card.method,
          cardEnvironment: card.environment,
          currentEnvironment: environment,
        });
      } else {
        const customer = await this.savedCardRepository.findProviderCustomer(
          profile.id,
          card.method,
          environment,
        );
        if (customer) {
          await provider.deleteSavedCard(
            customer.providerCustomerId,
            card.providerCardId,
            country,
          );
        }
      }
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        throw paymentProviderNotConfigured();
      }
      this.logger.error({
        event: 'saved_card_provider_delete_failed',
        savedCardId: card.id,
        errorName: error instanceof Error ? error.name : 'unknown',
        refused: error instanceof PaymentRequestRejectedError,
      });
      throw paymentProviderUnavailable();
    }

    await this.savedCardRepository.deleteCard(card.id);
    this.logger.log({ event: 'saved_card_deleted', savedCardId: card.id });
  }
}
