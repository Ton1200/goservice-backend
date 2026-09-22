import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { MercadoPagoPaymentAdapter } from './adapters/mercadopago-payment.adapter';
import { RapydPaymentAdapter } from './adapters/rapyd-payment.adapter';
import {
  CardTokenCapability,
  EmbeddedCheckoutCapability,
  PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderCapabilityError,
  SaveCardOnChargeCapability,
  SavedCardCapability,
  WalletRedirectCapability,
} from './ports/payment-provider.port';

/**
 * GOS-146 — the ONE place that maps a `PaymentMethod` (or a stored
 * `PaymentAttempt.method`) to the adapter that serves it. Replaces the single
 * `{ provide: PaymentProviderPort, useExisting: MercadoPagoPaymentAdapter }`
 * binding: services never hold "the" provider anymore, they ask the registry
 * for the one their attempt/flow belongs to. See `payment-provider.port.ts`'s
 * header for the capability model.
 *
 * A method with no adapter (`CASH` is not a provider) or an adapter that lacks
 * the requested capability throws `PaymentProviderCapabilityError` — never
 * `undefined`, so a wiring mistake surfaces at the first call instead of as a
 * `TypeError` deep inside a flow.
 *
 * Adding a provider: implement `PaymentProvider` (+ the capabilities it really
 * has), inject it here and add it to `providers`.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: ReadonlyMap<PaymentMethod, PaymentProvider>;

  constructor(
    mercadoPago: MercadoPagoPaymentAdapter,
    rapyd: RapydPaymentAdapter,
  ) {
    this.providers = new Map<PaymentMethod, PaymentProvider>(
      [mercadoPago, rapyd].map((provider) => [provider.method, provider]),
    );
  }

  /** Every registered provider — e.g. to build the available-methods catalog. */
  all(): PaymentProvider[] {
    return [...this.providers.values()];
  }

  /** The adapter for `method`. @throws PaymentProviderCapabilityError if there is none. */
  forMethod(method: PaymentMethod): PaymentProvider {
    const provider = this.providers.get(method);
    if (!provider) {
      throw new PaymentProviderCapabilityError(method, null);
    }
    return provider;
  }

  cardToken(method: PaymentMethod): PaymentProvider & CardTokenCapability {
    return this.withCapability<CardTokenCapability>(method, 'CARD_TOKEN');
  }

  walletRedirect(
    method: PaymentMethod,
  ): PaymentProvider & WalletRedirectCapability {
    return this.withCapability<WalletRedirectCapability>(
      method,
      'WALLET_REDIRECT',
    );
  }

  embeddedCheckout(
    method: PaymentMethod,
  ): PaymentProvider & EmbeddedCheckoutCapability {
    return this.withCapability<EmbeddedCheckoutCapability>(
      method,
      'EMBEDDED_CHECKOUT',
    );
  }

  savedCards(method: PaymentMethod): PaymentProvider & SavedCardCapability {
    return this.withCapability<SavedCardCapability>(method, 'SAVED_CARDS');
  }

  /** GOS-149 — see `SaveCardOnChargeCapability`'s own comment. */
  saveCardOnCharge(
    method: PaymentMethod,
  ): PaymentProvider & SaveCardOnChargeCapability {
    return this.withCapability<SaveCardOnChargeCapability>(
      method,
      'SAVE_CARD_ON_CHARGE',
    );
  }

  private withCapability<T>(
    method: PaymentMethod,
    capability: PaymentProviderCapability,
  ): PaymentProvider & T {
    const provider = this.forMethod(method);
    if (!provider.capabilities.has(capability)) {
      throw new PaymentProviderCapabilityError(method, capability);
    }
    return provider as PaymentProvider & T;
  }
}
