import { Injectable, Logger } from '@nestjs/common';
import { CountryCode, CustomerProfile, PaymentMethod } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { SavedCardRepository } from '../saved-card.repository';

export interface MercadoPagoCustomerLink {
  providerCustomerId: string;
  environment: string;
}

/**
 * GOS-149 — Mercado Pago's own version of `RapydSavedCardsCustomerService`:
 * the provider customer that saved cards hang from, one per GoService
 * Customer per (Mercado Pago) ENVIRONMENT. Created lazily, the FIRST time
 * `payEngagementWithCard` is called with `saveCard: true` (Mercado Pago has
 * no "save card" widget of its own — see
 * `SaveCardOnChargeCapability`'s own comment), and stored in
 * `PaymentProviderCustomer` so the same person is the same Mercado Pago
 * customer on every later payment.
 *
 * ONLY difference from the Rapyd version: Mercado Pago's credentials are
 * PER-COUNTRY, so `country` is threaded into every call — the Rapyd version
 * has no such parameter because Rapyd's ONE credential set serves every
 * country.
 *
 * Errors of the adapter are NOT translated here — same posture as the Rapyd
 * version: each caller decides whether a missing customer is fatal.
 */
@Injectable()
export class MercadoPagoSavedCardsCustomerService {
  private readonly logger = new Logger(
    MercadoPagoSavedCardsCustomerService.name,
  );

  constructor(
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly savedCardRepository: SavedCardRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  /** The existing link for the current Mercado Pago environment (for `country`), or `null`. Never calls Mercado Pago to create anything. */
  async find(
    customerProfileId: string,
    country: CountryCode,
  ): Promise<MercadoPagoCustomerLink | null> {
    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.MERCADOPAGO,
    );
    const environment = await provider.currentEnvironment(country);
    const existing = await this.savedCardRepository.findProviderCustomer(
      customerProfileId,
      PaymentMethod.MERCADOPAGO,
      environment,
    );
    return existing
      ? { providerCustomerId: existing.providerCustomerId, environment }
      : null;
  }

  /** The existing link, creating the Mercado Pago customer first if the Customer has none yet. */
  async ensure(
    profile: CustomerProfile,
    userId: string,
    country: CountryCode,
  ): Promise<MercadoPagoCustomerLink> {
    const existing = await this.find(profile.id, country);
    if (existing) {
      return existing;
    }

    const user = await this.usersRepository.findById(userId);
    const provider = this.paymentProviderRegistry.savedCards(
      PaymentMethod.MERCADOPAGO,
    );
    const environment = await provider.currentEnvironment(country);
    const { customerId } = await provider.createCustomer({
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      email: user?.email ?? '',
      externalReference: profile.id,
      country,
    });
    const stored = await this.savedCardRepository.createProviderCustomer({
      customerProfileId: profile.id,
      method: PaymentMethod.MERCADOPAGO,
      environment,
      providerCustomerId: customerId,
    });
    this.logger.log({
      event: 'mercadopago_customer_created',
      customerProfileId: profile.id,
      environment,
    });
    return {
      providerCustomerId: stored.providerCustomerId,
      environment,
    };
  }
}
