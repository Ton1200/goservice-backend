import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod, SavedPaymentCard } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { cardPaymentModuleDisabled } from '../errors/card-payment-module-disabled.error';
import { invalidCardPaymentInput } from '../errors/invalid-card-payment-input.error';
import { mercadoPagoSavedCardsDisabled } from '../errors/mercadopago-saved-cards-disabled.error';
import { paymentProviderNotConfigured } from '../errors/payment-provider-not-configured.error';
import { paymentProviderUnavailable } from '../errors/payment-provider-unavailable.error';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import {
  PaymentProviderNotConfiguredError,
  PaymentRequestRejectedError,
} from '../ports/payment-provider.port';
import { SavedCardRepository } from '../saved-card.repository';
import { MercadoPagoSavedCardsCustomerService } from './mercadopago-saved-cards-customer.service';

// A provider token is interpolated into nothing, but is still bounded to a
// plain identifier shape before it is sent anywhere.
const CARD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * GOS-150 follow-up — `Mutation.addSavedCard`: the Customer saves a Mercado
 * Pago card from "Mis tarjetas guardadas", with NO payment. Card management
 * only: no `PaymentAttempt`, no ledger entry, nothing is charged or
 * pre-authorized.
 *
 * The client tokenizes the card itself with Mercado Pago's public key; only
 * that fresh single-use token reaches this service (never the number or the
 * CVV). The token is associated to the Customer's Mercado Pago customer
 * (created on first use — the same `MercadoPagoSavedCardsCustomerService`
 * the save-on-charge path uses), then the vault is re-synced exactly like
 * `mySavedCards` does, and the saved card is returned.
 *
 * Offered only while the Mercado Pago card method AND its saved-cards switch
 * are ON (`canAddSavedCard`); deleting stays independent of both.
 */
@Injectable()
export class AddSavedCardService {
  private readonly logger = new Logger(AddSavedCardService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly mercadoPagoCustomerService: MercadoPagoSavedCardsCustomerService,
    private readonly savedCardRepository: SavedCardRepository,
  ) {}

  /** Whether "Agregar tarjeta" can work for this caller right now — never throws. */
  async canAddSavedCard(userId: string): Promise<boolean> {
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!profile || !(await this.isFeatureOn())) {
      return false;
    }
    try {
      return await this.paymentProviderRegistry
        .forMethod(PaymentMethod.MERCADOPAGO)
        .isConfigured(profile.country);
    } catch {
      return false;
    }
  }

  async addSavedCard(
    userId: string,
    cardToken: string,
  ): Promise<SavedPaymentCard> {
    const profile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!profile) {
      throw customerProfileRequired();
    }
    await this.assertFeatureOn();
    if (!CARD_TOKEN_PATTERN.test(cardToken)) {
      throw invalidCardPaymentInput();
    }

    const country = profile.country;
    try {
      const { providerCustomerId, environment } =
        await this.mercadoPagoCustomerService.ensure(profile, userId, country);
      const card = await this.paymentProviderRegistry
        .saveCardOnCharge(PaymentMethod.MERCADOPAGO)
        .associateCard(providerCustomerId, cardToken, country);
      // `syncCards` replaces the WHOLE stored list — always the full vault.
      const vault = await this.paymentProviderRegistry
        .savedCards(PaymentMethod.MERCADOPAGO)
        .listSavedCards(providerCustomerId, country);
      const synced = await this.savedCardRepository.syncCards(
        profile.id,
        PaymentMethod.MERCADOPAGO,
        environment,
        vault,
      );
      const saved = synced.find(
        (row) => row.providerCardId === card.providerCardId,
      );
      if (!saved) {
        // Associated, but the vault did not list it back — never report a
        // card the Customer cannot see.
        throw paymentProviderUnavailable();
      }
      this.logger.log({
        event: 'mercadopago_card_saved_directly',
        customerProfileId: profile.id,
      });
      return saved;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        throw paymentProviderNotConfigured();
      }
      if (error instanceof PaymentRequestRejectedError) {
        // Mercado Pago refused the token (expired, already used, invalid).
        throw invalidCardPaymentInput();
      }
      if (error instanceof DomainException) {
        throw error; // already a domain error (e.g. the unlisted-card case above)
      }
      this.logger.error({
        event: 'mercadopago_card_save_direct_failed',
        customerProfileId: profile.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw paymentProviderUnavailable();
    }
  }

  private async isFeatureOn(): Promise<boolean> {
    return (
      (await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.enabled,
      )) &&
      (await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.savedCardsEnabled,
      ))
    );
  }

  private async assertFeatureOn(): Promise<void> {
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.enabled,
      ))
    ) {
      throw cardPaymentModuleDisabled();
    }
    if (
      !(await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard.savedCardsEnabled,
      ))
    ) {
      throw mercadoPagoSavedCardsDisabled();
    }
  }
}
