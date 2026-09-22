import { Injectable } from '@nestjs/common';
import {
  CountryCode,
  EngagementStatus,
  PaymentAttemptStatus,
  PaymentMethod,
} from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../../engagements/engagements.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { CardPaymentAccessService } from '../card-payment-access.service';
import { PAYMENT_METHOD_SETTING_KEYS } from '../constants/payments-setting-keys.constants';
import { PaymentOptionKind } from '../models/payment-option-kind.enum';
import { PaymentAttemptRepository } from '../payment-attempt.repository';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import type {
  PaymentProvider,
  PaymentProviderCapability,
  WalletRedirectCapability,
} from '../ports/payment-provider.port';

export interface AvailablePaymentOption {
  method: PaymentMethod;
  kind: PaymentOptionKind;
  displayName: string;
  supportsSavedCards: boolean;
}

interface DigitalCatalogEntry {
  method: PaymentMethod;
  capability: PaymentProviderCapability;
  kind: PaymentOptionKind;
  keys: { enabled: string; displayName: string };
  /** Label used until an admin sets `display-name`. */
  fallbackDisplayName: string;
}

// The digital options GoService knows how to offer, in display order. One
// provider can appear more than once (Mercado Pago: a card AND a wallet); the
// (method, capability) pair is what says which flow an entry is, and its
// `kind` is what the client opens — the client never deduces it from the name.
const DIGITAL_CATALOG: readonly DigitalCatalogEntry[] = [
  {
    method: PaymentMethod.MERCADOPAGO,
    capability: 'CARD_TOKEN',
    kind: PaymentOptionKind.CARD_TOKEN,
    keys: PAYMENT_METHOD_SETTING_KEYS.mercadoPagoCard,
    fallbackDisplayName: 'Tarjeta de crédito o débito',
  },
  {
    method: PaymentMethod.RAPYD,
    capability: 'EMBEDDED_CHECKOUT',
    kind: PaymentOptionKind.EMBEDDED_CHECKOUT,
    keys: PAYMENT_METHOD_SETTING_KEYS.rapyd,
    fallbackDisplayName: 'Tarjeta',
  },
  {
    method: PaymentMethod.MERCADOPAGO,
    capability: 'WALLET_REDIRECT',
    kind: PaymentOptionKind.WALLET_REDIRECT,
    keys: PAYMENT_METHOD_SETTING_KEYS.mercadoPagoWallet,
    fallbackDisplayName: 'Mercado Pago',
  },
];

const CASH_FALLBACK_DISPLAY_NAME = 'Efectivo';

/**
 * Orchestrates `Query.availablePaymentMethods` (GOS-146) — the list of ways the
 * Customer can pay ONE Engagement right now, so the client knows which flow to
 * open (`kind`) without deducing it from a provider's name.
 *
 * An option appears only when it would actually START: its admin flag is ON
 * and — for the digital ones — the Customer's OWN country has complete
 * provider credentials (`PaymentProvider.isConfigured`; the wallet also needs
 * its redirect config, `isWalletConfigured`). Mercado Pago's card and wallet
 * are independent options with independent flags; `card.enabled` governs the
 * Mercado Pago card ONLY, never Rapyd. Everything is read fresh on every call.
 *
 * **How an Engagement's current payment state shapes the answer** (documented
 * choice — the ticket left it open):
 * - not payable by status (only `IN_PROGRESS | PENDING_CUSTOMER_CONFIRMATION |
 *   COMPLETED` are), or it already has an APPROVED attempt (paid) → `[]`;
 * - committed to CASH (`paymentMethod = CASH`, or a cash confirmation is the
 *   active attempt) → only the CASH option: a digital one would be refused
 *   with `PAYMENT_METHOD_CONFLICT`;
 * - a digital attempt is PENDING → the options are STILL listed: the client
 *   learns about that attempt from `myEngagementPaymentAttempt` and, to switch
 *   provider, calls `abandonEngagementPaymentAttempt` first (restarting the
 *   same Rapyd checkout is idempotent, so listing it is safe);
 * - otherwise → every enabled, configured option.
 *
 * Ownership: only the Engagement's own Customer (`CardPaymentAccessService`);
 * anyone else gets the anti-enumeration `engagementNotFound()`.
 */
@Injectable()
export class GetAvailablePaymentMethodsService {
  constructor(
    private readonly cardPaymentAccessService: CardPaymentAccessService,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async getAvailablePaymentMethods(
    userId: string,
    engagementId: string,
  ): Promise<AvailablePaymentOption[]> {
    const engagement =
      await this.cardPaymentAccessService.resolveCustomerEngagement(
        userId,
        engagementId,
      );

    if (
      engagement.status !== EngagementStatus.IN_PROGRESS &&
      engagement.status !== EngagementStatus.PENDING_CUSTOMER_CONFIRMATION &&
      engagement.status !== EngagementStatus.COMPLETED
    ) {
      return [];
    }

    const active = await this.paymentAttemptRepository.findActiveByEngagementId(
      engagement.id,
    );
    if (active?.status === PaymentAttemptStatus.APPROVED) {
      return [];
    }

    const cashOnly =
      engagement.paymentMethod === PaymentMethod.CASH ||
      active?.method === PaymentMethod.CASH;

    const options: AvailablePaymentOption[] = [];

    if (
      await this.platformSettingPort.isEnabled(
        PAYMENT_METHOD_SETTING_KEYS.cash.enabled,
      )
    ) {
      options.push({
        method: PaymentMethod.CASH,
        kind: PaymentOptionKind.CASH,
        displayName: await this.displayName(
          PAYMENT_METHOD_SETTING_KEYS.cash.displayName,
          CASH_FALLBACK_DISPLAY_NAME,
        ),
        supportsSavedCards: false,
      });
    }
    if (cashOnly) {
      return options;
    }

    const billingContext =
      await this.engagementsRepository.findByIdWithBillingContext(
        engagement.id,
      );
    if (!billingContext) {
      throw engagementNotFound(); // a hard delete raced this call
    }
    const country = billingContext.customerProfile.country;

    for (const entry of DIGITAL_CATALOG) {
      if (await this.isOffered(entry, country)) {
        options.push({
          method: entry.method,
          kind: entry.kind,
          displayName: await this.displayName(
            entry.keys.displayName,
            entry.fallbackDisplayName,
          ),
          supportsSavedCards: await this.supportsSavedCards(entry),
        });
      }
    }
    return options;
  }

  private async isOffered(
    entry: DigitalCatalogEntry,
    country: CountryCode,
  ): Promise<boolean> {
    let provider: PaymentProvider;
    try {
      provider = this.paymentProviderRegistry.forMethod(entry.method);
    } catch {
      return false; // no adapter registered — never offered
    }
    if (!provider.capabilities.has(entry.capability)) {
      return false;
    }
    if (!(await this.platformSettingPort.isEnabled(entry.keys.enabled))) {
      return false;
    }
    if (!(await provider.isConfigured(country))) {
      return false;
    }
    if (entry.capability === 'WALLET_REDIRECT') {
      return (
        provider as PaymentProvider & WalletRedirectCapability
      ).isWalletConfigured(country);
    }
    return true;
  }

  /**
   * Saved cards are a feature of the Rapyd method: offered only on the option
   * whose adapter has the capability, and only while its own switch is ON (the
   * method's own flag was already required for the option to be listed).
   */
  private async supportsSavedCards(
    entry: DigitalCatalogEntry,
  ): Promise<boolean> {
    if (
      entry.method !== PaymentMethod.RAPYD ||
      !this.paymentProviderRegistry
        .forMethod(entry.method)
        .capabilities.has('SAVED_CARDS')
    ) {
      return false;
    }
    return this.platformSettingPort.isEnabled(
      PAYMENT_METHOD_SETTING_KEYS.rapyd.savedCardsEnabled,
    );
  }

  private async displayName(key: string, fallback: string): Promise<string> {
    const value = await this.platformSettingPort.getValue(key);
    return value && value.trim() !== '' ? value.trim() : fallback;
  }
}
