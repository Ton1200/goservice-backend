import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod, SavedPaymentCard } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { PaymentProviderNotConfiguredError } from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

/**
 * Orchestrates `Query.mySavedCards` (GOS-146): the caller's saved Rapyd cards —
 * brand, last four, type and expiry, nothing sensitive.
 *
 * **Rapyd's vault is the source of truth.** A card is saved INSIDE Rapyd's
 * widget (the Customer ticks "save card" while paying), so GoService only
 * learns of it by asking Rapyd; every call therefore re-reads the customer's
 * vault and makes the local table mirror it (new cards appear, cards removed
 * on Rapyd's side disappear). If Rapyd cannot be reached the last synced list
 * is returned instead — listing must not break because a provider is down.
 * A Customer that never had a Rapyd customer created has, by definition, no
 * cards (`[]`, no provider call). A caller without a Customer profile also
 * gets `[]`.
 */
@Injectable()
export class ListMySavedCardsService {
  private readonly logger = new Logger(ListMySavedCardsService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly customerService: RapydSavedCardsCustomerService,
    private readonly savedCardRepository: SavedCardRepository,
  ) {}

  async listMySavedCards(userId: string): Promise<SavedPaymentCard[]> {
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!profile) {
      return [];
    }

    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.RAPYD,
    );
    let environment: string;
    let providerCustomerId: string;
    try {
      const link = await this.customerService.find(profile.id);
      if (!link) {
        return [];
      }
      environment = link.environment;
      providerCustomerId = link.providerCustomerId;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        throw paymentProviderNotConfigured();
      }
      throw error;
    }

    try {
      const cards = await provider.listSavedCards(providerCustomerId);
      return await this.savedCardRepository.syncCards(
        profile.id,
        PaymentMethod.RAPYD,
        environment,
        cards,
      );
    } catch (error) {
      // Rapyd unreachable / refused: fall back to what was last synced.
      this.logger.warn({
        event: 'saved_cards_sync_failed',
        customerProfileId: profile.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return this.savedCardRepository.listCards(
        profile.id,
        PaymentMethod.RAPYD,
        environment,
      );
    }
  }
}
