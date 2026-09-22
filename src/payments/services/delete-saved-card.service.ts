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
 * Orchestrates `Mutation.deleteSavedCard` (GOS-146): the Customer erases one of
 * their saved cards — from Rapyd's vault FIRST, then from GoService's table, so
 * a failure never leaves a card that looks deleted but can still be charged.
 *
 * - The card must belong to the caller's Customer profile; anything else is
 *   the anti-enumeration `SAVED_CARD_NOT_FOUND`.
 * - Rapyd's delete is idempotent (a card Rapyd no longer knows is fine), so a
 *   retry after a partial failure completes cleanly.
 * - A card saved in ANOTHER Rapyd environment than the one currently
 *   configured (a sandbox card after switching to production) cannot be
 *   removed from Rapyd with today's credentials; it is unusable anyway
 *   (charging only ever considers the current environment) and is removed
 *   locally, logged for an operator.
 * - Deliberately NOT behind the saved-cards switch: a Customer can always erase
 *   their card, even after the feature was turned off.
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

    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.RAPYD,
    );
    try {
      const environment = await provider.currentEnvironment();
      if (card.environment !== environment) {
        this.logger.warn({
          event: 'saved_card_deleted_locally_other_environment',
          savedCardId: card.id,
          cardEnvironment: card.environment,
          currentEnvironment: environment,
        });
      } else {
        const customer = await this.savedCardRepository.findProviderCustomer(
          profile.id,
          PaymentMethod.RAPYD,
          environment,
        );
        if (customer) {
          await provider.deleteSavedCard(
            customer.providerCustomerId,
            card.providerCardId,
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
