import { Injectable, Logger } from '@nestjs/common';
import {
  CustomerProfile,
  PaymentMethod,
  SavedPaymentCard,
} from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import { PaymentProviderNotConfiguredError } from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';
import { RapydSavedCardsCustomerService } from './rapyd-saved-cards-customer.service';

/**
 * Orchestrates `Query.mySavedCards` — the caller's saved cards across EVERY
 * provider that supports them (GOS-146: Rapyd; GOS-149: Mercado Pago) —
 * brand, last four, type and expiry, nothing sensitive.
 *
 * **Each provider's own vault is the source of truth for ITS cards.** A card
 * is only ever known to GoService by asking the provider, so every call
 * re-reads each enabled provider's vault and makes the local table mirror it
 * (new cards appear, cards removed on the provider's side disappear). If ONE
 * provider cannot be reached, its last synced list is returned instead — a
 * Mercado Pago outage must never hide the Customer's Rapyd cards, and vice
 * versa; listing must not break because a single provider is down. A
 * provider whose OWN saved-cards switch is off is silently excluded from the
 * merged list (not an error — the Customer simply doesn't see cards from a
 * capability that isn't offered right now). A Customer that never had a
 * provider customer created has, by definition, no cards there (`[]`, no
 * provider call). A caller without a Customer profile gets `[]`.
 */
@Injectable()
export class ListMySavedCardsService {
  private readonly logger = new Logger(ListMySavedCardsService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly rapydCustomerService: RapydSavedCardsCustomerService,
    private readonly mercadoPagoCustomerService: MercadoPagoSavedCardsCustomerService,
    private readonly savedCardRepository: SavedCardRepository,
  ) {}

  async listMySavedCards(userId: string): Promise<SavedPaymentCard[]> {
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!profile) {
      return [];
    }

    const results: SavedPaymentCard[] = [];
    for (const method of [PaymentMethod.RAPYD, PaymentMethod.MERCADOPAGO]) {
      if (!(await this.isSavedCardsEnabledFor(method))) {
        continue; // this provider's own feature is off — just excluded, no error
      }
      results.push(...(await this.listForMethod(profile, method)));
    }
    return results;
  }

  private async isSavedCardsEnabledFor(
    method: PaymentMethod,
  ): Promise<boolean> {
    const keys =
      method === PaymentMethod.MERCADOPAGO
        ? PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard
        : PAYMENT_METHOD_SETTING_KEYS.rapyd;
    return (
      (await this.platformSettingPort.isEnabled(keys.enabled)) &&
      (await this.platformSettingPort.isEnabled(keys.savedCardsEnabled))
    );
  }

  private async listForMethod(
    profile: CustomerProfile,
    method: PaymentMethod,
  ): Promise<SavedPaymentCard[]> {
    const provider = this.paymentProviderRegistry.savedCards(method);
    let environment: string;
    let providerCustomerId: string;
    try {
      const link =
        method === PaymentMethod.MERCADOPAGO
          ? await this.mercadoPagoCustomerService.find(
              profile.id,
              profile.country,
            )
          : await this.rapydCustomerService.find(profile.id);
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
      const cards =
        method === PaymentMethod.MERCADOPAGO
          ? await provider.listSavedCards(providerCustomerId, profile.country)
          : await provider.listSavedCards(providerCustomerId);
      return await this.savedCardRepository.syncCards(
        profile.id,
        method,
        environment,
        cards,
      );
    } catch (error) {
      // Provider unreachable / refused: fall back to what was last synced,
      // scoped to THIS provider only.
      this.logger.warn({
        event: 'saved_cards_sync_failed',
        customerProfileId: profile.id,
        method,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return this.savedCardRepository.listCards(
        profile.id,
        method,
        environment,
      );
    }
  }
}
