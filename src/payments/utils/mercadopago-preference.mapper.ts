import type { MercadoPagoEnvironment } from '../constants/payments-setting-keys.constants';
import type { CreateWalletPreferenceCommand } from '../ports/payment-provider.port';

/**
 * Pure mapping for Mercado Pago's **Checkout Preferences API**
 * (`POST https://api.mercadopago.com/checkout/preferences` — NO `/v1/`
 * prefix, unlike the Orders API; confirmed live GOS-142, 2026-09-18: `/v1/…`
 * answers 404, the bare path answers 201). Used ONLY to start a wallet
 * (redirect-to-Mercado-Pago-account) payment — card payments go through the
 * Orders API (`mercadopago-order.mapper.ts`) and never touch this file.
 *
 * Kept separate from `MercadoPagoPaymentAdapter` so it is testable with zero
 * NestJS/network machinery, same reasoning as the Orders/payment-record
 * mappers next to it.
 */

export interface MercadoPagoPreferenceBackUrls {
  success: string;
  pending: string;
  failure: string;
}

export interface MercadoPagoPreferenceRequest {
  items: {
    title: string;
    quantity: number;
    currency_id: string;
    unit_price: number;
  }[];
  /**
   * Live-verified (GOS-142 spike, 2026-09-18/19, Colombia sandbox, a funded
   * test buyer): `wallet_purchase` makes the checkout prominently offer
   * "Dinero disponible" (account balance) — RECOMMENDED and pre-selected —
   * alongside "Nueva Tarjeta". It does NOT exclusively restrict to
   * balance-only; a saved-card option was never reached live (the test buyer
   * had no saved card), so that part of the ticket's question is still
   * unconfirmed.
   */
  purpose: 'wallet_purchase';
  external_reference: string;
  payer: { email: string };
  back_urls: MercadoPagoPreferenceBackUrls;
  notification_url: string;
}

export interface MercadoPagoPreferenceResponse {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
}

export interface WalletPreferenceMappingResult {
  preferenceId: string;
  redirectUrl: string;
}

/**
 * `command.amount` is passed straight through as `unit_price` — live-verified
 * (GOS-142 spike, COP, `50000` accepted): this endpoint takes a PLAIN
 * INTEGER, NOT the zero-decimal-STRING convention `formatMercadoPagoAmount`
 * produces for the Orders API (genuinely different formatting between the
 * two APIs). Since `PaymentAttempt.amount`/`LedgerEntry.amount` are always
 * whole-unit integers already in this codebase, no currency-specific
 * formatting is needed here, unlike `formatMercadoPagoAmount`.
 */
export function buildWalletPreferenceRequest(
  command: CreateWalletPreferenceCommand,
  backUrls: MercadoPagoPreferenceBackUrls,
  notificationUrl: string,
): MercadoPagoPreferenceRequest {
  return {
    items: [
      {
        title: command.description,
        quantity: 1,
        currency_id: command.currency.toUpperCase(),
        unit_price: command.amount,
      },
    ],
    purpose: 'wallet_purchase',
    external_reference: command.externalReference,
    payer: { email: command.payerEmail },
    back_urls: backUrls,
    notification_url: notificationUrl,
  };
}

/**
 * `init_point` vs `sandbox_init_point`: Mercado Pago returns both, but only
 * `sandbox_init_point` actually completes a transaction under TEST
 * credentials (used live, GOS-142 spike) — `init_point` is documented as the
 * one production credentials must use. The credential's OWN environment
 * (never a per-call flag) decides which one this returns, so a preference
 * created with sandbox credentials can never leak a production redirect URL
 * or vice versa. Returns `null` when the response has no id or no usable URL
 * for that environment — the caller treats that as "outcome unknown", same
 * as `mapOrderToSnapshot`'s `null` case.
 */
export function mapPreferenceResponse(
  json: MercadoPagoPreferenceResponse | null | undefined,
  environment: MercadoPagoEnvironment,
): WalletPreferenceMappingResult | null {
  if (!json || typeof json !== 'object' || !json.id) {
    return null;
  }
  const redirectUrl =
    environment === 'sandbox' ? json.sandbox_init_point : json.init_point;
  if (!redirectUrl) {
    return null;
  }
  return { preferenceId: json.id, redirectUrl };
}
