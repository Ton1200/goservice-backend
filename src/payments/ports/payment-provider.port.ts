import { CountryCode, PaymentMethod } from '@prisma/client';

/**
 * Provider-agnostic seam for collecting a payment — same Port/Adapter shape as
 * `StoragePort`/`SessionPort`/`EmailClientPort`/`IdentityVerificationPort`,
 * but MODELLED BY CAPABILITIES, not as one monolithic port (GOS-146).
 *
 * **Why capabilities.** The first provider (Mercado Pago) shaped the original
 * port: the client tokenizes a card and the server charges the token
 * (`chargeCard`), or redirects to a wallet (`createWalletPreference`). Rapyd
 * does NEITHER — the server creates a *checkout*, and the payment is completed
 * inside an embedded widget. Forcing both behind one abstract class would make
 * every adapter implement methods it cannot honour. Instead:
 *
 * - `PaymentProvider` — what EVERY digital provider offers: which
 *   `PaymentMethod` it collects for (`method`), which flows it supports
 *   (`capabilities`), whether it is fully configured for a country
 *   (`isConfigured`), re-reading a charge by the provider's own id
 *   (`readPayment`) and the best-effort card facts (`getTransactionDetails`).
 * - `CardTokenCapability` — `chargeCard` (client-side card token; Mercado Pago).
 * - `WalletRedirectCapability` — `createWalletPreference` +
 *   `getPaymentByPaymentId` (redirect to the provider's own account; Mercado
 *   Pago only).
 * - `EmbeddedCheckoutCapability` — `createCheckout` + `getCheckoutSnapshot`
 *   (server creates a checkout, the widget completes it in-app, NO redirect;
 *   Rapyd).
 * - `SavedCardCapability` (GOS-146) — a provider-side customer, a vault of
 *   tokenized cards, and charging one of them from the server (Rapyd Card on
 *   File). It only ever holds a provider TOKEN: the card is typed into the
 *   provider's own widget and never reaches GoService.
 *
 * `PaymentProviderRegistry` (`../payment-provider.registry.ts`) is the ONE
 * place that maps a `PaymentMethod` (or a stored `PaymentAttempt.method`) to
 * its adapter; a method with no adapter, or one that lacks the requested
 * capability, fails EXPLICITLY (`PaymentProviderCapabilityError`) instead of
 * returning `undefined`. `capabilities` is also what `availablePaymentMethods`
 * derives its `kind` from, so a client never deduces a flow from a provider's
 * name. Adding a provider = one adapter class implementing the capabilities it
 * really has + one line in the registry + one `PaymentMethod` enum value.
 * (Saved-card tokenization, GOS-83, was dropped 2026-09-18: Mercado Pago has no
 * reusable card token — see domain-model.md. **Reopened 2026-09-21 as GOS-149**,
 * at explicit Product request: Mercado Pago DOES support a reusable
 * *provider-side vault* — a `Customer` + `Card` the CVV must still be
 * re-entered against on every charge — which is different from, and narrower
 * than, a reusable card *token*. See `SavedCardCapability`'s own comment for
 * how Mercado Pago's shape differs from Rapyd's one-tap vault.)
 * - `SaveCardOnChargeCapability` (GOS-149) — a provider that can only ever add
 *   a card to the vault as a side effect of a normal charge (Mercado Pago has
 *   no "save card" widget the way Rapyd's embedded checkout does).
 *
 * **Scope, deliberately narrow (GOS-85, DEC-009 findings)**: a SIMPLE charge
 * into GoService's own provider account. There is NO split/`marketplace_fee`
 * parameter and NO provider-side hold/capture/`escrow` mode here — paying the
 * Professional is a separate concern (GOS-82/GOS-139), and the 7-day
 * retention is a purely internal ledger concept, never something the provider
 * does for us.
 *
 * The card NEVER reaches GoService's servers: `cardToken` is a single-use
 * token the client obtained by tokenizing the card directly with the provider,
 * and an embedded checkout collects the card inside the provider's own iframe
 * (PCI scope stays SAQ-A either way). It must never be logged or persisted.
 */

/** A small, stable DOMAIN vocabulary — never the processor's raw detail. */
export type CardRejectionReason =
  | 'CARD_DECLINED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_CARD_DATA'
  | 'PROVIDER_ERROR'
  // GOS-146 — a saved card was charged from the server but the issuer demands
  // the Customer authenticate (3D Secure). Nothing was charged; the client
  // falls back to the normal embedded checkout, where the challenge can be shown.
  | 'AUTHENTICATION_REQUIRED'
  // GOS-146 — the Customer opened an embedded checkout and walked away, then
  // asked to pick another provider (`abandonEngagementPaymentAttempt`). No
  // money moved; it is a normal, non-error way for an attempt to end.
  | 'ABANDONED'
  | 'OTHER';

export interface ChargeCardCommand {
  /** Single-use token from the client-side tokenization. Never logged. */
  cardToken: string;
  /** Major-unit integer amount (same convention as `LedgerEntry.amount`). */
  amount: number;
  /** ISO 4217 code, e.g. `COP` / `ARS`. */
  currency: string;
  /**
   * The Customer's own country (`CustomerProfile.country`) — selects WHICH
   * country's Mercado Pago credentials this charge is made with (2026-09-18:
   * one Mercado Pago account belongs to exactly one country's marketplace).
   */
  country: CountryCode;
  description: string;
  /** `Engagement.id` — lets an asynchronous notification be correlated back. */
  externalReference: string;
  // The three fields below are NOT in the original ticket's command shape:
  // the Orders API REQUIRES them (verified live 2026-09-18 — a request
  // without `payment_method.id` or `payer` is answered 400 `required_properties`).
  /** The card brand id the client's tokenization reported, e.g. `visa`, `master`. */
  paymentMethodId: string;
  installments: number;
  payerEmail: string;
  /**
   * Makes a retry of THIS logical charge safe: the provider returns the same
   * order for the same key instead of charging twice (verified live
   * 2026-09-18). `PaymentAttempt.id`.
   */
  idempotencyKey: string;
  /**
   * GOS-149 — the Customer ticked "save this card". Best-effort, ONLY on an
   * `approved` result, and NEVER lets a failure to save affect the charge
   * itself (see `PayEngagementWithCardService`'s own comment). Optional,
   * defaults to not saving — zero behavior change for an existing caller
   * that never sends it.
   */
  saveCard?: boolean;
}

export interface ChargeCardResult {
  /** The provider's id for the charge (Mercado Pago: the ORDER id). */
  providerPaymentId: string;
  status: 'approved' | 'rejected' | 'pending';
  rejectionReason?: CardRejectionReason;
}

/** What a provider read (`readPayment` and friends) returns: the charge result plus what's needed to correlate/verify it. */
export interface ProviderPaymentSnapshot extends ChargeCardResult {
  /** Echo of the `externalReference` sent at creation (`Engagement.id`). */
  externalReference: string | null;
  /** Major-unit amount the provider reports for the whole charge. */
  amount: number | null;
  currency: string | null;
}

/**
 * GOS-142 — what `createWalletPreference` needs to start a wallet
 * (redirect-to-Mercado-Pago-account) payment. Deliberately NOT
 * `ChargeCardCommand` reused: there is no `cardToken`/`paymentMethodId`/
 * `installments` here (the Customer picks all of that inside their own
 * Mercado Pago account, after the redirect) — this command only carries what
 * GoService itself decides.
 */
export interface CreateWalletPreferenceCommand {
  /** Major-unit integer amount (same convention as `ChargeCardCommand.amount`). */
  amount: number;
  /** ISO 4217 code, e.g. `COP` / `ARS`. */
  currency: string;
  /** See `ChargeCardCommand.country`'s own comment. */
  country: CountryCode;
  description: string;
  /** `Engagement.id` — same correlation role as `ChargeCardCommand.externalReference`. */
  externalReference: string;
  payerEmail: string;
}

/** What `createWalletPreference` returns: where to redirect the Customer's browser/app. */
export interface WalletPreferenceResult {
  /**
   * Mercado Pago's preference id — a THIRD, distinct id shape
   * (`<collector_id>-<uuid>`), never an order id or a payment id. Logged for
   * traceability only; NEVER stored in `PaymentAttempt.providerPaymentId` —
   * the wallet attempt is always correlated to its later webhook by
   * `findPendingWithoutProviderIdByEngagementId`, not by this id (see the
   * plan's own design notes).
   */
  preferenceId: string;
  /**
   * The URL to open — `sandbox_init_point` under sandbox credentials,
   * `init_point` under production ones (the CREDENTIAL's own environment
   * decides, never a per-call flag — see `mapPreferenceResponse`'s own
   * comment).
   */
  redirectUrl: string;
}

/**
 * Non-sensitive facts about HOW a payment was made, read from the provider's
 * own record once it is approved — what GoService keeps for follow-up and to
 * show the Customer "Visa •••• 6260". Never the card number, CVV, token,
 * cardholder or payer personal data. Every field is nullable: a provider may
 * not report it, and a wallet payment made with balance has no card.
 */
export interface ProviderTransactionDetails {
  /** e.g. `credit_card`, `debit_card`, `account_money`. */
  paymentTypeId: string | null;
  cardBrand: string | null;
  /** Exactly 4 digits, or null. */
  cardLastFour: string | null;
  /** What the provider charged GoService (major units, rounded). Informational. */
  providerFeeAmount: number | null;
  providerTaxAmount: number | null;
  /** What GoService actually receives after fee and tax withholdings. */
  netReceivedAmount: number | null;
  approvedAt: Date | null;
  moneyReleaseAt: Date | null;
}

/**
 * The provider answered definitively that this request creates NO charge
 * (e.g. a malformed/unprocessable request). The attempt is REJECTED.
 */
export class PaymentRequestRejectedError extends Error {
  constructor(readonly rejectionReason: CardRejectionReason) {
    super(`Payment request rejected by provider (${rejectionReason}).`);
    this.name = 'PaymentRequestRejectedError';
  }
}

/**
 * The outcome is UNKNOWN (timeout, network error, provider 5xx): a charge may
 * or may not exist. The attempt must stay PENDING — never assumed rejected —
 * so a later notification can still resolve it.
 */
export class PaymentProviderUnavailableError extends Error {
  constructor(detail: string) {
    super(`Payment provider unavailable: ${detail}`);
    this.name = 'PaymentProviderUnavailableError';
  }
}

/**
 * Credentials/environment are missing or invalid — nothing was sent to the
 * provider. Fail-closed, same philosophy as `ledgerCommissionMisconfigured`.
 */
export class PaymentProviderNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Payment provider not configured: ${detail}`);
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

/** Which payment flows a provider supports — see this file's header. */
export type PaymentProviderCapability =
  | 'CARD_TOKEN'
  | 'WALLET_REDIRECT'
  | 'EMBEDDED_CHECKOUT'
  | 'SAVED_CARDS'
  // GOS-149 — a provider that can attach the token from a JUST-COMPLETED
  // charge to a customer's vault (Mercado Pago: `POST
  // /v1/customers/{id}/cards`). Deliberately NOT part of `SavedCardCapability`
  // — Rapyd's vault fills itself, inside its own widget, and would otherwise
  // need this as a permanent dead method; keeping it separate means
  // `PaymentProviderRegistry.saveCardOnCharge('RAPYD')` fails the same
  // explicit way as any other capability mismatch instead.
  | 'SAVE_CARD_ON_CHARGE';

/**
 * A registry lookup asked for a method that has no adapter (e.g. `CASH` —
 * cash is not a provider) or for a capability the method's adapter does not
 * have. A programming/wiring error, never a runtime condition a Customer can
 * cause: it fails EXPLICITLY instead of returning `undefined`.
 */
export class PaymentProviderCapabilityError extends Error {
  constructor(
    readonly method: PaymentMethod,
    readonly capability: PaymentProviderCapability | null,
  ) {
    super(
      capability
        ? `Payment method ${method} does not support the ${capability} capability.`
        : `Payment method ${method} has no payment provider adapter.`,
    );
    this.name = 'PaymentProviderCapabilityError';
  }
}

/** What every digital provider offers, whatever flows it supports. */
export interface PaymentProvider {
  /** The `PaymentMethod` (collector) this adapter serves. */
  readonly method: PaymentMethod;
  readonly capabilities: ReadonlySet<PaymentProviderCapability>;

  /**
   * `true` only when EVERYTHING this provider needs to start a payment for
   * `country` is configured (credentials + a valid environment, and — for a
   * flow that needs them — its own extra config). Reads `PlatformSetting` on
   * every call, never throws for "not configured" (that is the answer). Used
   * by `availablePaymentMethods` so an option is never offered that would only
   * fail once chosen.
   */
  isConfigured(country: CountryCode): Promise<boolean>;

  /**
   * Re-reads the provider's own current state for a charge, by the provider's
   * OWN id (`PaymentAttempt.providerPaymentId`) — used by the read-time
   * reconciliation (`myEngagementPaymentAttempt`) so it dispatches by the
   * attempt's METHOD, never by guessing the provider from the id's shape (the
   * order-vs-payment id distinction, if any, is this adapter's private
   * business). Resolves `null` when the provider does not know this id (or it
   * is not a well-formed id at all). Throws `PaymentProviderUnavailableError` /
   * `PaymentProviderNotConfiguredError` like the other reads. `country` — see
   * `ChargeCardCommand.country`'s own comment; the caller always derives it
   * from an authoritative source, never from an untrusted notification body.
   */
  readPayment(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null>;

  /**
   * BEST-EFFORT read of the non-sensitive facts of an APPROVED payment (brand,
   * last four, the provider's fee/taxes/net, dates). Resolves `null` when the
   * provider has no record for it yet (its payment record can lag the order by
   * a moment). The caller must treat any failure as "unknown" and NEVER fail or
   * delay the payment because of it. `externalReference` is the reference sent
   * at creation (`Engagement.id`); the record is linked to the order by its
   * EXACT id, never guessed by amount or date. `country` — see `readPayment`'s
   * own comment.
   */
  getTransactionDetails(
    providerPaymentId: string,
    externalReference: string,
    country: CountryCode,
  ): Promise<ProviderTransactionDetails | null>;
}

/** Client-side card token, charged by the server (Mercado Pago). */
export interface CardTokenCapability {
  /**
   * @throws PaymentRequestRejectedError — definitive "no charge was created".
   * @throws PaymentProviderUnavailableError — unknown outcome.
   * @throws PaymentProviderNotConfiguredError — nothing was sent.
   * A DECLINED card is NOT an exception: it resolves with `status: 'rejected'`.
   */
  chargeCard(command: ChargeCardCommand): Promise<ChargeCardResult>;
}

/** Redirect to the provider's own account (Mercado Pago wallet). */
export interface WalletRedirectCapability {
  /**
   * `true` only when the wallet flow's OWN extra config (public base URL and
   * `back_urls`) is present on top of what `PaymentProvider.isConfigured`
   * checks (credentials) — the wallet needs both, the card flow only the
   * credentials.
   */
  isWalletConfigured(country: CountryCode): Promise<boolean>;

  /**
   * GOS-142 — re-reads the provider's own current state for a WALLET payment,
   * directly from the legacy Payments API (`GET /v1/payments/{id}`) — NOT the
   * Orders API. For a wallet payment the Orders API resource never reflects a
   * wallet-completed checkout (evidence: `goservice-docs/research/gos-75-mercado-pago-poc/evidence.md`
   * — a payment made with account balance settles against a DIFFERENT/legacy
   * resource only `GET /v1/payments/{id}` can see). This is the wallet
   * webhook's own source of truth; same throws/null contract as `readPayment`.
   */
  getPaymentByPaymentId(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null>;

  /**
   * GOS-142 — starts a wallet (redirect-to-Mercado-Pago-account) payment:
   * `POST https://api.mercadopago.com/checkout/preferences` (NOT `/v1/orders`
   * — a different Mercado Pago API entirely, confirmed live it has NO `/v1/`
   * prefix), `purpose: 'wallet_purchase'`. `back_urls`/`notification_url` are
   * NOT parameters here — the adapter reads them itself from
   * `mercadoPagoWalletCheckoutSettingKeys()` and fails closed
   * (`PaymentProviderNotConfiguredError`) if either is missing, same
   * philosophy as a missing access token.
   *
   * @throws PaymentProviderUnavailableError — outcome unknown (timeout/5xx).
   * @throws PaymentProviderNotConfiguredError — credentials OR
   *   `back_urls`/`notification_url` missing; nothing was sent, or the
   *   provider rejected the credentials.
   *   There is no "rejected" outcome here (unlike `chargeCard`): creating a
   *   preference does not charge anything yet — the Customer has not even
   *   been redirected.
   */
  createWalletPreference(
    command: CreateWalletPreferenceCommand,
  ): Promise<WalletPreferenceResult>;
}

/**
 * GOS-146 — what `createCheckout` needs. Like `CreateWalletPreferenceCommand`
 * there is NO card data and NO payer detail: the Customer types the card into
 * the provider's own embedded widget. Only what GoService itself decides.
 */
export interface CreateCheckoutCommand {
  /** Major-unit integer amount (same convention as `ChargeCardCommand.amount`). */
  amount: number;
  /** ISO 4217 code, e.g. `COP` / `ARS`. */
  currency: string;
  /** See `ChargeCardCommand.country`'s own comment. */
  country: CountryCode;
  description: string;
  /** `Engagement.id` — lets a notification be correlated back. */
  externalReference: string;
  /**
   * The provider's customer id for the paying Customer
   * (`SavedCardCapability.createCustomer`). When set, the checkout is linked to
   * that customer and the widget offers to SAVE the card for future payments
   * (unticked — the Customer opts in). Omitted → no saving is offered.
   */
  customerId?: string;
  /**
   * `PaymentAttempt.id`, sent as the provider's idempotency key where one exists.
   * NOT a safety guarantee: Rapyd was verified live (2026-09-21) NOT to honor it on
   * `POST /v1/checkout` — repeating a create can produce a second, orphan checkout.
   */
  idempotencyKey: string;
}

export interface CheckoutResult {
  /** The provider's id for the checkout — exists BEFORE any payment does. */
  checkoutId: string;
  /**
   * The provider's embeddable widget script for the country's environment
   * (sandbox or production). Never a redirect URL.
   */
  toolkitScriptUrl: string;
}

/**
 * The provider's own current view of a CHECKOUT (and the payment nested in
 * it, if any). `status` follows the rule "the CHECKOUT decides": `approved`
 * only when a payment inside it is paid; `rejected` only when the checkout
 * itself is terminal without a payment (expired / blocked); anything else —
 * including a failed payment inside a checkout that is still open, where the
 * widget lets the Customer retry — is `pending`, so a later successful retry
 * is never lost to an attempt already marked rejected.
 */
export interface ProviderCheckoutSnapshot extends Omit<
  ProviderPaymentSnapshot,
  'providerPaymentId'
> {
  checkoutId: string;
  /** The nested payment's id, once one exists. */
  providerPaymentId: string | null;
  /** `true` once the provider created ANY payment inside this checkout. */
  paymentCreated: boolean;
  /** `true` while the checkout can still be completed by the Customer. */
  open: boolean;
}

/** Server creates a checkout; the provider's embedded widget completes it in-app (Rapyd). */
export interface EmbeddedCheckoutCapability {
  /**
   * @throws PaymentProviderUnavailableError — outcome unknown (timeout/5xx).
   * @throws PaymentProviderNotConfiguredError — credentials missing/rejected.
   * @throws PaymentRequestRejectedError — the provider refused the request.
   */
  createCheckout(command: CreateCheckoutCommand): Promise<CheckoutResult>;

  /**
   * The embeddable widget script URL for `country`'s environment — what a
   * RESUMED checkout (same id, no new create call) is returned with.
   * @throws PaymentProviderNotConfiguredError — credentials/environment missing.
   */
  getToolkitScriptUrl(country: CountryCode): Promise<string>;

  /**
   * Re-reads the provider's own current view of a checkout. Resolves `null`
   * when the provider does not know this id. Same throws as `readPayment`.
   */
  getCheckoutSnapshot(
    checkoutId: string,
    country: CountryCode,
  ): Promise<ProviderCheckoutSnapshot | null>;
}

/** GOS-146 — what `createCustomer` needs: only what identifies the person to the provider. */
export interface CreateProviderCustomerCommand {
  name: string;
  email: string;
  /** `CustomerProfile.id` — lets the provider record be traced back. */
  externalReference: string;
  /**
   * GOS-149 — required IN PRACTICE for Mercado Pago (credentials are
   * per-country, see `ChargeCardCommand.country`'s own comment); Rapyd's
   * adapter never reads it (one global credential set for every country) —
   * omitting it is zero behavior change for Rapyd. Optional only so every
   * existing call site keeps compiling unchanged.
   */
  country?: CountryCode;
}

/**
 * A card in the provider's vault, as far as GoService may know it: NON-sensitive
 * facts only (never the number, CVV or holder). `providerCardId` is the
 * provider's reusable token.
 */
export interface ProviderSavedCard {
  providerCardId: string;
  brand: string | null;
  /** Exactly 4 digits, or null. */
  lastFour: string | null;
  type: 'credit_card' | 'debit_card' | null;
  expirationMonth: number | null;
  /** Four digits (`2030`), or null. */
  expirationYear: number | null;
}

export interface ChargeSavedCardCommand {
  /** The provider customer that owns the card. */
  customerId: string;
  providerCardId: string;
  /** Major-unit integer amount (same convention as `LedgerEntry.amount`). */
  amount: number;
  /** ISO 4217 code, e.g. `COP` / `ARS`. */
  currency: string;
  description: string;
  /** `Engagement.id`, echoed by the provider so a notification can be correlated. */
  externalReference: string;
  /** `PaymentAttempt.id`, sent as the provider's idempotency key where one exists. */
  idempotencyKey: string;
  /** GOS-149 — see `CreateProviderCustomerCommand.country`'s own comment. */
  country?: CountryCode;
  /**
   * GOS-149 — MERCADO PAGO ONLY. A fresh single-use token the CLIENT obtained,
   * immediately before this call, by tokenizing `{ card_id: providerCardId,
   * security_code: <the CVV the Customer just typed> }` with Mercado Pago's
   * OWN client-side SDK — Mercado Pago has no CVV-less server-side charge of
   * a stored card (confirmed no such path exists in their docs). Rapyd's
   * adapter never reads it (a true one-tap charge, no CVV) — zero behavior
   * change for Rapyd. `MercadoPagoPaymentAdapter.chargeSavedCard` treats this
   * as functionally required: absent, it rejects with `INVALID_CARD_DATA`
   * before sending anything.
   */
  providerToken?: string;
  /**
   * GOS-149 — MERCADO PAGO ONLY. The Orders API's `payment_method.id` (e.g.
   * `visa`, `master`) — required on every order, same as
   * `ChargeCardCommand.paymentMethodId`. The adapter has no database access
   * to look the stored card's own brand up, so the caller (which already
   * loaded the `SavedPaymentCard` row) passes it straight through —
   * conveniently, `SavedPaymentCard.brand` for a Mercado Pago card already
   * IS this same id (see `mapMercadoPagoStoredCard`). Rapyd's adapter never
   * reads it.
   */
  paymentMethodId?: string;
  /**
   * GOS-149 — MERCADO PAGO ONLY. The Orders API requires `payer.email` on
   * every order (verified live, GOS-85) — `chargeCard` already has this same
   * field; a saved-card charge needs it too, for the same reason. Rapyd's
   * adapter never reads it.
   */
  payerEmail?: string;
}

/**
 * Card vault + server-side charging of a saved card. Two real shapes exist
 * behind this ONE interface:
 * - **Rapyd (Card on File)** — a true one-tap charge: no widget, no CVV, the
 *   Customer is only present in the app. Its vault fills itself, inside its
 *   own embedded-checkout widget (see `SAVE_CARD_ON_CHARGE`'s own comment).
 * - **Mercado Pago (GOS-149)** — NOT one-tap: Mercado Pago has no CVV-less
 *   server-side charge, so the CLIENT still tokenizes `{ card_id,
 *   security_code }` right before every charge (see
 *   `ChargeSavedCardCommand.providerToken`'s own comment) — the saved card
 *   only saves the Customer from re-typing the card NUMBER, never the CVV.
 *   Its vault is only ever populated as a side effect of a normal charge
 *   (`SaveCardOnChargeCapability`), since Mercado Pago has no "save card"
 *   widget of its own in this codebase.
 *
 * `country?: CountryCode` on every method below is REQUIRED in practice for
 * Mercado Pago (per-country credentials) and never read by Rapyd (one global
 * credential set) — see `CreateProviderCustomerCommand.country`'s own
 * comment for why it is optional at the type level.
 */
export interface SavedCardCapability {
  /**
   * The provider environment the credentials belong to (`sandbox` |
   * `production`). Provider customer ids and card tokens only exist inside ONE
   * environment, so they are stored together with it.
   * @throws PaymentProviderNotConfiguredError
   */
  currentEnvironment(country?: CountryCode): Promise<string>;

  /**
   * Creates the provider's customer record for a GoService Customer.
   * @throws PaymentProviderUnavailableError — outcome unknown (timeout/5xx).
   * @throws PaymentProviderNotConfiguredError — credentials missing/rejected.
   * @throws PaymentRequestRejectedError — the provider refused the request.
   */
  createCustomer(
    command: CreateProviderCustomerCommand,
  ): Promise<{ customerId: string }>;

  /**
   * The customer's cards currently in the provider's vault (the source of
   * truth). An unknown customer resolves to an empty list. Same throws as
   * `createCustomer`.
   */
  listSavedCards(
    customerId: string,
    country?: CountryCode,
  ): Promise<ProviderSavedCard[]>;

  /**
   * Charges a saved card, with the Customer present in the app. For Rapyd
   * this is a true one-tap payment — no widget, no raw card, no CVV. A
   * declined card is NOT an exception: it resolves with `status: 'rejected'`.
   * If the issuer demands 3D Secure the payment is cancelled and it resolves
   * `rejected` with `AUTHENTICATION_REQUIRED` (nothing is charged). `pending`
   * = the provider has not answered definitively; a notification resolves
   * it.
   * @throws PaymentProviderUnavailableError — outcome unknown (timeout/5xx).
   * @throws PaymentProviderNotConfiguredError — credentials missing/rejected.
   * @throws PaymentRequestRejectedError — the provider refused the request
   *   (for Mercado Pago, this INCLUDES a missing `providerToken`/
   *   `paymentMethodId` — see `ChargeSavedCardCommand`'s own comments).
   */
  chargeSavedCard(
    command: ChargeSavedCardCommand,
  ): Promise<ProviderPaymentSnapshot>;

  /**
   * Re-reads a charge made with `chargeSavedCard`. For Rapyd, unlike a
   * payment inside an embedded checkout (which the widget lets the Customer
   * retry, so only the CHECKOUT can end an attempt), a server-side charge has
   * nobody to retry it: a failed/cancelled/expired one IS terminal, so it
   * resolves `rejected` here. Resolves `null` when the provider does not know
   * this id. Same throws as `createCustomer`.
   */
  readSavedCardCharge(
    providerPaymentId: string,
    country?: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null>;

  /**
   * Erases the card from the provider's vault. Idempotent: a card the provider
   * no longer knows resolves normally. Same throws as `createCustomer`.
   */
  deleteSavedCard(
    customerId: string,
    providerCardId: string,
    country?: CountryCode,
  ): Promise<void>;
}

/**
 * GOS-149 — a provider that can only ever add a card to the vault as a side
 * effect of a normal charge (Mercado Pago: `payEngagementWithCard` with
 * `saveCard: true`). Deliberately SEPARATE from `SavedCardCapability`: Rapyd
 * never implements this (its vault fills itself, inside its own embedded
 * checkout widget, never as a side effect of a server-side call this
 * codebase makes) — keeping it its own capability means
 * `PaymentProviderRegistry.saveCardOnCharge('RAPYD')` fails EXPLICITLY, the
 * same way any other capability mismatch does, instead of a dead method that
 * would sit unused on `RapydPaymentAdapter` forever.
 */
export interface SaveCardOnChargeCapability {
  /**
   * @throws PaymentProviderUnavailableError — outcome unknown (timeout/5xx).
   * @throws PaymentProviderNotConfiguredError — credentials missing/rejected.
   * @throws PaymentRequestRejectedError — the provider refused to attach it.
   */
  associateCard(
    customerId: string,
    cardToken: string,
    country: CountryCode,
  ): Promise<ProviderSavedCard>;
}
