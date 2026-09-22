import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  RAPYD_ENVIRONMENTS,
  RapydEnvironment,
  rapydCheckoutSettingKeys,
  rapydSettingKeys,
} from '../constants/payments-setting-keys.constants';
import {
  ChargeSavedCardCommand,
  CheckoutResult,
  CreateCheckoutCommand,
  CreateProviderCustomerCommand,
  EmbeddedCheckoutCapability,
  PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  ProviderCheckoutSnapshot,
  ProviderPaymentSnapshot,
  ProviderSavedCard,
  ProviderTransactionDetails,
  SavedCardCapability,
} from '../ports/payment-provider.port';
import {
  RapydCheckout,
  RapydPayment,
  RapydStoredCard,
  extractRapydErrorCode,
  isRapydCheckoutId,
  isRapydCustomerId,
  isRapydPaymentId,
  isRapydStoredCardId,
  mapCheckoutToSnapshot,
  mapPaymentToDetails,
  mapPaymentToSnapshot,
  mapRapydStoredCard,
  mapSavedCardCharge,
  unwrapRapydData,
  unwrapRapydList,
} from '../utils/rapyd-checkout.mapper';
import { signRapydRequest } from '../utils/rapyd-signature.util';

// Unlike Mercado Pago (one host, the CREDENTIAL tells sandbox from
// production), Rapyd has one API host and one Checkout Toolkit script host PER
// ENVIRONMENT (docs.rapyd.net/en/environments.html and
// /en/checkout-toolkit-integration.html). The sandbox hosts were exercised
// live in GOS-75; the production ones are read from the docs only.
const RAPYD_API_BASE_URLS: Record<RapydEnvironment, string> = {
  sandbox: 'https://sandboxapi.rapyd.net',
  production: 'https://api.rapyd.net',
};
const RAPYD_TOOLKIT_SCRIPT_URLS: Record<RapydEnvironment, string> = {
  sandbox: 'https://sandboxcheckouttoolkit.rapyd.net',
  production: 'https://checkouttoolkit.rapyd.net',
};

// Creating a checkout is a plain database write on Rapyd's side; this is only
// the ceiling before the outcome is treated as UNKNOWN.
const REQUEST_TIMEOUT_MS = 20_000;

// The details lookup is best-effort and runs right after a payment is
// approved: it must never make the Customer wait for it.
const DETAILS_TIMEOUT_MS = 4_000;

// Sanity bounds for `payments.payment-methods.rapyd.checkout-expiration-minutes`: at least a
// minute, at most Rapyd's own 14-day default.
const MIN_EXPIRATION_MINUTES = 1;
const MAX_EXPIRATION_MINUTES = 14 * 24 * 60;

interface RapydResponse {
  status: number;
  json: unknown;
}

interface Credentials {
  accessKey: string;
  secretKey: string;
  environment: RapydEnvironment;
}

/**
 * `PaymentProvider` + `EmbeddedCheckoutCapability` over Rapyd's **Checkout
 * Toolkit** (GOS-146): the server creates a checkout (`POST /v1/checkout`) and
 * the Customer completes it INSIDE the app in Rapyd's embedded widget — no
 * redirect, and the card never touches GoService's servers (PCI SAQ-A).
 * Deliberately NOT used: the Hosted Checkout Page (redirects), `POST
 * /v1/hosted/collect/card` (redirects) and `POST /v1/payments` with a raw card
 * (would require GoService's own PCI certification). A SIMPLE charge into
 * GoService's own Rapyd account: no split and NO `escrow` (the 7-day
 * retention is the internal ledger's concept, GOS-82/GOS-139; paying the
 * Professional is out of scope).
 *
 * Plain `fetch`, no SDK — same posture as `MercadoPagoPaymentAdapter`.
 * Requests are signed per https://docs.rapyd.net/en/request-signatures.html
 * (`signRapydRequest`; see that util for the algorithm and its provenance).
 * Credentials are read from `PlatformSettingPort` on EVERY call (never cached),
 * fail-closed (`PaymentProviderNotConfiguredError`). Never logs the access/secret
 * key.
 *
 * **ONE credential set for every country** (verified live 2026-09-21: the same
 * keys created and completed both a Colombia/COP and an Argentina/ARS payment —
 * a Rapyd account is multi-country, unlike a Mercado Pago one). So the
 * `country` parameters the `PaymentProvider` port carries (they exist for
 * Mercado Pago's per-country credentials) are deliberately NOT declared here:
 * only `createCheckout` uses `command.country`, as a field of the checkout itself
 * (the Customer's own country).
 *
 * What was verified LIVE against the sandbox (GOS-75 PoC, `evidence.md`):
 * `POST /v1/checkout` for AR/ARS and CO/COP (integer amounts), the embedded
 * widget, `GET /v1/checkout/{id}` (`DON` + nested payment `CLO`/`paid:true`),
 * `GET /v1/payments/{id}`, 3D Secure (`ACT`, `next_action: 3d_verification`).
 * **Verified live by GOS-146 (2026-09-21, Colombia sandbox)**: `POST /v1/checkout`
 * is accepted WITHOUT `complete_checkout_url`/`error_checkout_url` (Rapyd fills both
 * with `https://www.rapyd.net`) and without `payment_method_types_include`;
 * `merchant_reference_id` is accepted and comes back on the NESTED `payment`
 * (NOT at the checkout's top level, despite the docs), even before any payment
 * exists; the lifetime is set by `page_expiration` (unix seconds) — the docs'
 * `expiration` field is IGNORED (checkout stayed at 14 days);
 * **the `idempotency` header is NOT honored on `POST /v1/checkout`** (the same key
 * created two different checkouts), so a repeated create can leave an orphan
 * checkout — it is still sent (harmless), but nothing relies on it.
 * **Also verified live**: a COMPLETE payment (widget → card 4111… → 3D Secure
 * simulator → `CLO`/`paid:true`), driven with a real browser (Playwright).
 * NOT verified live: any failed/expired payment, the production hosts, and the
 * webhook. See the GOS-146 report.
 *
 * `payment_method_types_include` is deliberately NEVER sent: the GOS-75 PoC
 * found that restricting it to a single method broke the widget before it
 * even reached the API. The checkout IS restricted to the `card` CATEGORY
 * (`payment_method_type_categories: ['card']`) — verified live in Colombia to be
 * necessary (see `createCheckout`) and to leave the widget working: the card
 * form opens directly and a payment completes.
 */
@Injectable()
export class RapydPaymentAdapter
  implements PaymentProvider, EmbeddedCheckoutCapability, SavedCardCapability
{
  private readonly logger = new Logger(RapydPaymentAdapter.name);

  readonly method = PaymentMethod.RAPYD;
  readonly capabilities: ReadonlySet<PaymentProviderCapability> =
    new Set<PaymentProviderCapability>(['EMBEDDED_CHECKOUT', 'SAVED_CARDS']);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async isConfigured(): Promise<boolean> {
    try {
      await this.loadCredentials();
      return true;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        return false;
      }
      throw error;
    }
  }

  async createCheckout(
    command: CreateCheckoutCommand,
  ): Promise<CheckoutResult> {
    const credentials = await this.loadCredentials();
    const expiration = await this.resolveExpiration();

    const { status, json } = await this.request(
      'POST',
      '/v1/checkout',
      credentials,
      {
        idempotencyKey: command.idempotencyKey,
        body: {
          amount: command.amount,
          currency: command.currency,
          country: command.country,
          description: command.description,
          // Linking the checkout to a Rapyd customer is what makes the widget
          // offer "Save card for future payments" (unticked; verified live).
          ...(command.customerId ? { customer: command.customerId } : {}),
          // The Engagement id — the correlation key for a notification whose
          // ids matched nothing (validated as a UUID before it is ever used).
          merchant_reference_id: command.externalReference,
          // Restrict the widget to the CARD category (many types, NOT the
          // single-method `payment_method_types_include` that broke the widget in
          // the PoC). Verified live in Colombia: WITHOUT this the Toolkit opens on
          // the first category it finds (bank/PSE/Addi), shows no way to reach the
          // card form, and paying fails with ERROR_CREATE_HOSTED_PAGE_PAYMENT.
          payment_method_type_categories: ['card'],
          // `page_expiration`, NOT `expiration` (ignored by Rapyd — verified live).
          ...(expiration !== null ? { page_expiration: expiration } : {}),
        },
      },
    );

    if (status >= 200 && status < 300) {
      const checkout = unwrapRapydData<RapydCheckout>(json);
      if (!checkout?.id || !isRapydCheckoutId(checkout.id)) {
        // A 2xx without a usable checkout id: a checkout MAY exist — outcome
        // unknown, never assumed rejected.
        throw new PaymentProviderUnavailableError(
          'success response without a checkout id',
        );
      }
      this.logger.log({
        event: 'rapyd_checkout_created',
        environment: credentials.environment,
        checkoutId: checkout.id,
      });
      return {
        checkoutId: checkout.id,
        toolkitScriptUrl: RAPYD_TOOLKIT_SCRIPT_URLS[credentials.environment],
      };
    }

    this.throwForFailedRequest(status, json, credentials, 'checkout_create');
  }

  async getToolkitScriptUrl(): Promise<string> {
    const { environment } = await this.loadCredentials();
    return RAPYD_TOOLKIT_SCRIPT_URLS[environment];
  }

  async getCheckoutSnapshot(
    checkoutId: string,
  ): Promise<ProviderCheckoutSnapshot | null> {
    if (!isRapydCheckoutId(checkoutId)) {
      return null;
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'GET',
      `/v1/checkout/${checkoutId}`,
      credentials,
    );

    if (status >= 200 && status < 300) {
      const snapshot = mapCheckoutToSnapshot(
        unwrapRapydData<RapydCheckout>(json),
      );
      if (!snapshot) {
        // A 2xx that carries no usable checkout is a provider fault, NOT "the
        // provider doesn't know this checkout" — the caller must not conclude
        // it doesn't exist.
        throw new PaymentProviderUnavailableError(
          'success response without a checkout',
        );
      }
      return snapshot;
    }
    return this.nullOrThrowForFailedRead(status, json, credentials);
  }

  async readPayment(
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    if (!isRapydPaymentId(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'GET',
      `/v1/payments/${providerPaymentId}`,
      credentials,
    );

    if (status >= 200 && status < 300) {
      const snapshot = mapPaymentToSnapshot(
        unwrapRapydData<RapydPayment>(json),
      );
      if (!snapshot) {
        throw new PaymentProviderUnavailableError(
          'success response without a payment',
        );
      }
      return snapshot;
    }
    return this.nullOrThrowForFailedRead(status, json, credentials);
  }

  /**
   * BEST-EFFORT facts of an APPROVED payment (brand, last four, card type) —
   * see `mapPaymentToDetails` for what is and is not known about Rapyd's
   * field names. The record is linked by its EXACT payment id; if Rapyd echoes
   * a merchant reference it must equal the one sent at creation, otherwise
   * nothing is attributed. The caller treats every failure as "unknown".
   */
  async getTransactionDetails(
    providerPaymentId: string,
    externalReference: string,
  ): Promise<ProviderTransactionDetails | null> {
    if (!externalReference || !isRapydPaymentId(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'GET',
      `/v1/payments/${providerPaymentId}`,
      credentials,
      { timeoutMs: DETAILS_TIMEOUT_MS },
    );

    if (status === 401 || status === 403) {
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    if (status === 404) {
      return null;
    }
    if (status < 200 || status >= 300) {
      throw new PaymentProviderUnavailableError(`HTTP ${status}`);
    }
    const payment = unwrapRapydData<RapydPayment>(json);
    if (
      !payment ||
      (payment.merchant_reference_id &&
        payment.merchant_reference_id !== externalReference)
    ) {
      return null;
    }
    return mapPaymentToDetails(payment);
  }

  // ---- SavedCardCapability (GOS-146) -------------------------------------
  // Rapyd's card vault (Card on File). Verified live 2026-09-21 in the sandbox
  // (Colombia and Argentina, same credential set): a customer (`cus_…`) is
  // created with `POST /v1/customers`; a checkout created WITH `customer`
  // shows the widget's "Save card for future payments" checkbox; the saved
  // card (`card_…`) is listed by `GET /v1/customers/{id}/payment_methods`; and
  // `POST /v1/payments` with `customer` + `payment_method: card_…` +
  // `payment_method_options.installments` charges it server-side, no 3DS/CVV.

  async currentEnvironment(): Promise<string> {
    return (await this.loadCredentials()).environment;
  }

  async createCustomer(
    command: CreateProviderCustomerCommand,
  ): Promise<{ customerId: string }> {
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'POST',
      '/v1/customers',
      credentials,
      {
        body: {
          name: command.name,
          email: command.email,
          // The GoService `CustomerProfile.id`: lets an operator trace a Rapyd
          // customer back. (Rapyd echoes it; it is not a secret.)
          metadata: { goserviceCustomerProfileId: command.externalReference },
        },
      },
    );
    if (status >= 200 && status < 300) {
      const customer = unwrapRapydData<{ id?: string }>(json);
      if (!customer?.id || !isRapydCustomerId(customer.id)) {
        throw new PaymentProviderUnavailableError(
          'success response without a customer id',
        );
      }
      return { customerId: customer.id };
    }
    this.throwForFailedRequest(status, json, credentials, 'customer_create');
  }

  async listSavedCards(customerId: string): Promise<ProviderSavedCard[]> {
    if (!isRapydCustomerId(customerId)) {
      return [];
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'GET',
      `/v1/customers/${customerId}/payment_methods`,
      credentials,
    );
    if (status >= 200 && status < 300) {
      return unwrapRapydList<RapydStoredCard>(json)
        .map((card) => mapRapydStoredCard(card))
        .filter((card): card is ProviderSavedCard => card !== null);
    }
    if (status === 404) {
      return [];
    }
    this.throwForFailedRequest(status, json, credentials, 'cards_list');
  }

  async chargeSavedCard(
    command: ChargeSavedCardCommand,
  ): Promise<ProviderPaymentSnapshot> {
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'POST',
      '/v1/payments',
      credentials,
      {
        idempotencyKey: command.idempotencyKey,
        body: {
          amount: command.amount,
          currency: command.currency,
          description: command.description,
          merchant_reference_id: command.externalReference,
          customer: command.customerId,
          // A stored TOKEN — never card data (no PCI scope). The LatAm card
          // types REQUIRE `installments` (verified live: without it Rapyd answers
          // INVALID_REQUIRED_PAYMENT_METHOD_FIELDS); GoService only sells 1.
          payment_method: command.providerCardId,
          payment_method_options: { installments: 1 },
        },
      },
    );
    if (status >= 200 && status < 300) {
      const payment = unwrapRapydData<RapydPayment>(json);
      const snapshot = mapSavedCardCharge(payment);
      if (!snapshot) {
        // A 2xx without a usable payment: a charge MAY exist — outcome unknown.
        throw new PaymentProviderUnavailableError(
          'success response without a payment',
        );
      }
      if (snapshot.rejectionReason === 'AUTHENTICATION_REQUIRED') {
        await this.cancelPayment(snapshot.providerPaymentId, credentials);
      }
      return snapshot;
    }
    this.throwForFailedRequest(status, json, credentials, 'saved_card_charge');
  }

  async readSavedCardCharge(
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    if (!isRapydPaymentId(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'GET',
      `/v1/payments/${providerPaymentId}`,
      credentials,
    );
    if (status >= 200 && status < 300) {
      const snapshot = mapSavedCardCharge(unwrapRapydData<RapydPayment>(json));
      if (!snapshot) {
        throw new PaymentProviderUnavailableError(
          'success response without a payment',
        );
      }
      return snapshot;
    }
    return this.nullOrThrowForFailedRead(status, json, credentials);
  }

  async deleteSavedCard(
    customerId: string,
    providerCardId: string,
  ): Promise<void> {
    if (
      !isRapydCustomerId(customerId) ||
      !isRapydStoredCardId(providerCardId)
    ) {
      return;
    }
    const credentials = await this.loadCredentials();
    const { status, json } = await this.request(
      'DELETE',
      `/v1/customers/${customerId}/payment_methods/${providerCardId}`,
      credentials,
    );
    if ((status >= 200 && status < 300) || status === 404) {
      return; // gone — deleting is idempotent
    }
    this.throwForFailedRequest(status, json, credentials, 'card_delete');
  }

  /**
   * Cancels a payment Rapyd left waiting for 3D Secure so it can never be
   * completed later without GoService seeing it. Best-effort: the attempt is
   * being REJECTED either way, so a failure here is logged (an operator can
   * reconcile), never thrown.
   */
  private async cancelPayment(
    providerPaymentId: string,
    credentials: Credentials,
  ): Promise<void> {
    try {
      const { status } = await this.request(
        'DELETE',
        `/v1/payments/${providerPaymentId}`,
        credentials,
      );
      if (status < 200 || status >= 300) {
        this.logger.error({
          event: 'rapyd_payment_cancel_failed',
          paymentId: providerPaymentId,
          httpStatus: status,
        });
      }
    } catch {
      this.logger.error({
        event: 'rapyd_payment_cancel_failed',
        paymentId: providerPaymentId,
      });
    }
  }

  /**
   * Maps the failure of a CREATE call to the port's error contract:
   * 401/403 → `NotConfigured` (Rapyd answers a bad key or a bad signature with
   * 401); 408/409/429/5xx → `Unavailable` (outcome unknown); any other 4xx →
   * `Rejected` (Rapyd refused the request and created no checkout — 400 is
   * OUR request being malformed, an integration bug, not the Customer's card).
   */
  private throwForFailedRequest(
    status: number,
    json: unknown,
    credentials: Credentials,
    operation: string,
  ): never {
    if (status === 401 || status === 403) {
      this.logger.error({
        event: 'rapyd_credentials_rejected',
        httpStatus: status,
        errorCode: extractRapydErrorCode(json),
        environment: credentials.environment,
      });
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      throw new PaymentProviderUnavailableError(`HTTP ${status}`);
    }
    this.logger.error({
      event: 'rapyd_request_refused',
      operation,
      httpStatus: status,
      errorCode: extractRapydErrorCode(json),
      environment: credentials.environment,
    });
    throw new PaymentRequestRejectedError(
      status === 400 ? 'PROVIDER_ERROR' : 'OTHER',
    );
  }

  /**
   * The failure of a READ: 404 → `null` ("Rapyd does not know this id");
   * 401/403 → `NotConfigured`; 408/409/429/5xx → `Unavailable` (the caller
   * retries, e.g. a webhook is answered 5xx); any other 4xx → also `null`
   * — a permanent refusal of a lookup must not make Rapyd retry the same
   * notification forever — but logged as an error for an operator.
   */
  private nullOrThrowForFailedRead(
    status: number,
    json: unknown,
    credentials: Credentials,
  ): null {
    if (status === 404) {
      return null;
    }
    if (status === 401 || status === 403) {
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      throw new PaymentProviderUnavailableError(`HTTP ${status}`);
    }
    this.logger.error({
      event: 'rapyd_read_refused',
      httpStatus: status,
      errorCode: extractRapydErrorCode(json),
      environment: credentials.environment,
    });
    return null;
  }

  private async loadCredentials(): Promise<Credentials> {
    const keys = rapydSettingKeys();
    const [accessKey, secretKey, environment] = await Promise.all([
      this.platformSettingPort.getValue(keys.accessKey),
      this.platformSettingPort.getValue(keys.secretKey),
      this.platformSettingPort.getValue(keys.environment),
    ]);
    if (!accessKey || accessKey.trim() === '') {
      throw new PaymentProviderNotConfiguredError('access key missing');
    }
    if (!secretKey || secretKey.trim() === '') {
      throw new PaymentProviderNotConfiguredError('secret key missing');
    }
    if (
      !environment ||
      !(RAPYD_ENVIRONMENTS as readonly string[]).includes(environment)
    ) {
      throw new PaymentProviderNotConfiguredError(
        'environment must be "sandbox" or "production"',
      );
    }
    return {
      accessKey: accessKey.trim(),
      secretKey: secretKey.trim(),
      environment: environment as RapydEnvironment,
    };
  }

  /**
   * `page_expiration` (unix seconds) from `payments.payment-methods.rapyd.checkout-expiration-minutes`,
   * or `null` — parameter omitted, Rapyd's own default applies — when the
   * setting is absent or not an integer in range. Never fails a payment start
   * for a tunable.
   */
  private async resolveExpiration(): Promise<number | null> {
    const raw = await this.platformSettingPort.getValue(
      rapydCheckoutSettingKeys().checkoutExpirationMinutes,
    );
    if (!raw || !/^\d+$/.test(raw.trim())) {
      return null;
    }
    const minutes = Number(raw.trim());
    if (minutes < MIN_EXPIRATION_MINUTES || minutes > MAX_EXPIRATION_MINUTES) {
      return null;
    }
    return Math.floor(Date.now() / 1000) + minutes * 60;
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    urlPath: string,
    credentials: Credentials,
    options?: { body?: unknown; idempotencyKey?: string; timeoutMs?: number },
  ): Promise<RapydResponse> {
    // The signed body and the sent body MUST be the same string; an empty body
    // is `""`, never `{}`.
    const body =
      options?.body !== undefined ? JSON.stringify(options.body) : '';
    const { salt, timestamp, signature } = signRapydRequest({
      method,
      urlPath,
      body,
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      access_key: credentials.accessKey,
      salt,
      timestamp,
      signature,
    };
    if (options?.idempotencyKey) {
      headers['idempotency'] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetch(
        `${RAPYD_API_BASE_URLS[credentials.environment]}${urlPath}`,
        {
          method,
          headers,
          body: body !== '' ? body : undefined,
          signal: AbortSignal.timeout(options?.timeoutMs ?? REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      // Timeout / DNS / connection reset: the request may or may not have been
      // processed. Only the error's class name is kept — never its text.
      throw new PaymentProviderUnavailableError(
        error instanceof Error ? error.name : 'network error',
      );
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null; // an HTML/empty body (e.g. an edge error page)
    }
    return { status: response.status, json };
  }
}
