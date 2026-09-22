import { Injectable, Logger } from '@nestjs/common';
import { CustomerProfile, PaymentMethod } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { SavedCardRepository } from '../saved-card.repository';

export interface RapydCustomerLink {
  providerCustomerId: string;
  environment: string;
}

/**
 * The provider customer (`cus_…`) that saved cards hang from — one per
 * GoService Customer per Rapyd ENVIRONMENT (GOS-146). Created lazily the first
 * time a Customer is offered to save a card, and stored in
 * `PaymentProviderCustomer`, so the same person is the same Rapyd customer on
 * every later payment (that is what lets Rapyd's widget list and reuse cards).
 *
 * Only a name and an email are sent to Rapyd — the same the Customer already
 * gave GoService, nothing about the Engagement or the Professional.
 *
 * Errors of the adapter (`PaymentProviderUnavailableError`,
 * `PaymentProviderNotConfiguredError`, `PaymentRequestRejectedError`) are NOT
 * translated here: each caller decides whether a missing customer is fatal
 * (charging a saved card) or just means "no card saving this time" (starting a
 * normal checkout).
 */
@Injectable()
export class RapydSavedCardsCustomerService {
  private readonly logger = new Logger(RapydSavedCardsCustomerService.name);

  constructor(
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly savedCardRepository: SavedCardRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  /** The existing link for the current Rapyd environment, or `null`. Never calls Rapyd to create anything. */
  async find(customerProfileId: string): Promise<RapydCustomerLink | null> {
    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.RAPYD,
    );
    const environment = await provider.currentEnvironment();
    const existing = await this.savedCardRepository.findProviderCustomer(
      customerProfileId,
      PaymentMethod.RAPYD,
      environment,
    );
    return existing
      ? { providerCustomerId: existing.providerCustomerId, environment }
      : null;
  }

  /** The existing link, creating the Rapyd customer first if the Customer has none yet. */
  async ensure(
    profile: CustomerProfile,
    userId: string,
  ): Promise<RapydCustomerLink> {
    const existing = await this.find(profile.id);
    if (existing) {
      return existing;
    }

    const user = await this.usersRepository.findById(userId);
    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.RAPYD,
    );
    const environment = await provider.currentEnvironment();
    const { customerId } = await provider.createCustomer({
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      email: user?.email ?? '',
      externalReference: profile.id,
    });
    const stored = await this.savedCardRepository.createProviderCustomer({
      customerProfileId: profile.id,
      method: PaymentMethod.RAPYD,
      environment,
      providerCustomerId: customerId,
    });
    this.logger.log({
      event: 'rapyd_customer_created',
      customerProfileId: profile.id,
      environment,
    });
    return {
      providerCustomerId: stored.providerCustomerId,
      environment,
    };
  }
}
