import { CountryCode } from '@prisma/client';

/**
 * GOS-85 — the `PlatformSetting` keys this module reads. NEVER hardcoded
 * values, NEVER `.env` — same mechanism every other credential in this
 * backend uses (`identity.didit.*`, `notifications.email.resend.*`). Documented
 * by name and purpose only (see goservice-docs/architecture/infrastructure.md).
 *
 * **Per-country credentials (2026-09-18)** — a Mercado Pago account belongs to
 * exactly ONE country's marketplace (verified live: two applications under the
 * same owner still resolve to the same single collector/country — there is no
 * such thing as "one account, many countries"). So each `Engagement`'s
 * `CustomerProfile.country` selects which credential set to use, and every key
 * below is scoped under `payments.mercadopago.<lowercased CountryCode>.*`
 * instead of one flat global set. A future country is one more `CountryCode`
 * value plus 4 more admin-configured rows — no code change to this function.
 *
 * - `accessToken` — ENCRYPTED. Mercado Pago's server-side access token.
 *   Verified live (2026-09-18, GOS-85 spike) that an `APP_USR-` sandbox pair
 *   from a test user completes a card charge through the Orders API; the
 *   adapter is credential-prefix-agnostic (just `Authorization: Bearer`).
 * - `publicKey` — plain (not a secret). The mobile card form needs the RIGHT
 *   country's key to tokenize the card client-side — it is meant to be
 *   `isPublic` (readable through `platformConfig`, same as
 *   `customer.social-login.*.client-id`), which naturally nests it under
 *   `payments.mercadopago.<country>.publicKey` for the mobile client to pick
 *   by the Customer's own known country. The backend itself never needs it to
 *   charge.
 * - `environment` — `sandbox` | `production`, independent PER COUNTRY (a
 *   documented, human-confirmed decision, 2026-09-18): one country can go to
 *   production while another is still being certified. Mercado Pago tells
 *   sandbox from production by the CREDENTIAL, not the host (same
 *   `api.mercadopago.com`), so this is a deliberate, admin-visible statement
 *   of intent that the adapter validates (fail-closed) and logs on every
 *   charge — it does not switch an endpoint.
 * - `webhookSecret` — ENCRYPTED. The per-application secret Mercado Pago
 *   generates when the webhook is saved; used to verify `x-signature` on the
 *   asynchronous `order` notification. Each country's Mercado Pago
 *   application is configured (in Mercado Pago's own dashboard) to call this
 *   backend's country-specific webhook route
 *   (`POST /webhooks/mercadopago/orders/:country`), which is how the country
 *   — and therefore which secret to check — is known BEFORE anything in the
 *   notification body is trusted.
 */
export function mercadoPagoSettingKeys(country: CountryCode) {
  const prefix = `payments.mercadopago.${country.toLowerCase()}`;
  return {
    accessToken: `${prefix}.access-token`,
    publicKey: `${prefix}.public-key`,
    environment: `${prefix}.environment`,
    webhookSecret: `${prefix}.webhook-secret`,
  } as const;
}

export const MERCADOPAGO_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type MercadoPagoEnvironment = (typeof MERCADOPAGO_ENVIRONMENTS)[number];

/**
 * GOS-142 — the config a wallet (redirect-to-Mercado-Pago-account) payment
 * needs to build `back_urls`/`notification_url` for `POST
 * /checkout/preferences`. Deliberately GLOBAL (no `<country>` segment),
 * unlike `mercadoPagoSettingKeys` above: these are GoService's OWN URLs (where
 * the app/backend live), not a per-country provider credential — one
 * deployment has one public host regardless of how many countries' Mercado
 * Pago credentials it holds.
 *
 * - `publicBaseUrl` — this backend's own public HTTPS origin (e.g.
 *   `https://api.goservice.example`). `notification_url` is derived from it
 *   at call time as `${publicBaseUrl}/webhooks/mercadopago/payments/<country>`
 *   — the country segment still comes from the SAME per-country webhook route
 *   convention `mercadoPagoSettingKeys`'s own comment documents, so Mercado
 *   Pago's notification still tells the webhook controller which country
 *   (and therefore which secret) applies, exactly like the existing `order`
 *   topic route.
 * - `backUrlSuccess`/`backUrlPending`/`backUrlFailure` — where Mercado Pago
 *   redirects the Customer's browser back to after the hosted checkout
 *   (typically a mobile deep link or a thin web landing page the app owns).
 *   Not seeded with a real value (no public HTTPS URL exists in any
 *   environment yet, same documented gap as the `order` webhook) — reading
 *   these fails closed (`PaymentProviderNotConfiguredError`), same as a
 *   missing access token.
 */
export function mercadoPagoWalletCheckoutSettingKeys() {
  const prefix = 'payments.mercadopago';
  return {
    publicBaseUrl: `${prefix}.public-base-url`,
    backUrlSuccess: `${prefix}.wallet.back-url-success`,
    backUrlPending: `${prefix}.wallet.back-url-pending`,
    backUrlFailure: `${prefix}.wallet.back-url-failure`,
  } as const;
}
