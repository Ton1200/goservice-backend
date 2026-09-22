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
 * below is scoped under `payments.payment-methods.mercadopago.<lowercased CountryCode>.*`
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
 *   `payments.payment-methods.mercadopago.<country>.publicKey` for the mobile client to pick
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
  const prefix = `payments.payment-methods.mercadopago.${country.toLowerCase()}`;
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
  const prefix = 'payments.payment-methods.mercadopago';
  return {
    // NOT Mercado Pago's: the backend's own public origin, shared by every
    // provider's callbacks (Mercado Pago's wallet AND Rapyd's webhook), so it
    // lives in the platform's general settings, not under a provider.
    publicBaseUrl: 'payments.general-settings.callbacks.public-base-url',
    backUrlSuccess: `${prefix}.wallet.back-url-success`,
    backUrlPending: `${prefix}.wallet.back-url-pending`,
    backUrlFailure: `${prefix}.wallet.back-url-failure`,
  } as const;
}

/**
 * GOS-146 — the `PlatformSetting` keys the Rapyd adapter reads. Same rules as
 * `mercadoPagoSettingKeys` above: NEVER hardcoded values, NEVER `.env`,
 * documented by name and purpose only.
 *
 * **ONE credential set for the whole platform (unlike Mercado Pago's per-
 * country ones)**: verified live on 2026-09-21 that the SAME access/secret key
 * created and completed a Colombia/COP payment AND an Argentina/ARS payment — a
 * Rapyd account is multi-country. So the keys and the environment are global
 * (`payments.payment-methods.rapyd.*`), with no `<country>` segment.
 *
 * - `accessKey` — ENCRYPTED. The Rapyd access key (sent as the `access_key`
 *   header, and part of every request's and webhook's signature).
 * - `secretKey` — ENCRYPTED. The Rapyd secret key: the HMAC key that signs
 *   every request AND the secret a webhook's signature is verified with (Rapyd
 *   has no separate webhook secret). The one credential that can move money.
 * - `environment` — `sandbox` | `production`, ONE for the platform (a key pair
 *   belongs to exactly one environment, so with one credential set there is
 *   one environment). Unlike Mercado Pago (which tells the two apart by the
 *   credential), Rapyd uses a DIFFERENT host per environment (API and Checkout
 *   Toolkit script), so this value really does switch the endpoints. Validated
 *   fail-closed.
 *
 * The Rapyd webhook URL is derived from the GLOBAL public base URL that
 * already exists for Mercado Pago (`mercadoPagoWalletCheckoutSettingKeys().publicBaseUrl`
 * — one deployment has one public host); no second base-URL setting is created.
 */
export function rapydSettingKeys() {
  const prefix = 'payments.payment-methods.rapyd';
  return {
    accessKey: `${prefix}.access-key`,
    secretKey: `${prefix}.secret-key`,
    environment: `${prefix}.environment`,
  } as const;
}

export const RAPYD_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type RapydEnvironment = (typeof RAPYD_ENVIRONMENTS)[number];

/**
 * GOS-146 — Rapyd tunables that are not credentials. Global (no `<country>`).
 * `checkoutExpirationMinutes` — how long a created checkout stays payable
 * before Rapyd expires it (sent as the checkout's `page_expiration` — verified
 * live that the docs' `expiration` field is ignored). Rapyd has NO
 * way to cancel a checkout, so a SHORT lifetime is what bounds the window in
 * which a widget the Customer walked away from can still be paid after
 * `abandonEngagementPaymentAttempt`. Missing/invalid → the parameter is
 * omitted and Rapyd's own default (14 days) applies.
 */
export function rapydCheckoutSettingKeys() {
  return {
    checkoutExpirationMinutes:
      'payments.payment-methods.rapyd.checkout-expiration-minutes',
  } as const;
}

/**
 * GOS-146 — the per-method kill switches and customer-facing labels the
 * `availablePaymentMethods` catalog reads. All live under
 * `payments.payment-methods.<method>.*`, which is how the admin panel's
 * settings tree groups them with zero frontend changes. `card.enabled`
 * GOVERNS THE MERCADO PAGO CARD FLOW ONLY — it is deliberately NOT reused as
 * Rapyd's flag.
 */
export const PAYMENT_METHOD_SETTING_KEYS = {
  cash: {
    enabled: 'payments.payment-methods.cash.enabled',
    displayName: 'payments.payment-methods.cash.display-name',
  },
  mercadoPagoCard: {
    enabled: 'payments.payment-methods.mercadopago.card.enabled',
    displayName: 'payments.payment-methods.mercadopago.card.display-name',
    // GOS-149 — the "saved cards" feature OF the Mercado Pago card method.
    // Global, like `enabled` — the switch is global even though Mercado
    // Pago's credentials are per-country (see this file's own header
    // comment). Only effective while `enabled` is ON too; independent of
    // Rapyd's own `savedCardsEnabled` below.
    savedCardsEnabled:
      'payments.payment-methods.mercadopago.card.saved-cards-enabled',
  },
  mercadoPagoWallet: {
    enabled: 'payments.payment-methods.mercadopago.wallet.enabled',
    displayName: 'payments.payment-methods.mercadopago.wallet.display-name',
  },
  rapyd: {
    enabled: 'payments.payment-methods.rapyd.enabled',
    displayName: 'payments.payment-methods.rapyd.display-name',
    // GOS-146 — the "saved cards" feature OF the Rapyd method. Only effective
    // while `enabled` is ON too (a feature of the method, not a second method).
    savedCardsEnabled: 'payments.payment-methods.rapyd.saved-cards-enabled',
  },
} as const;
