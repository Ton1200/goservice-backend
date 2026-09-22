import { Injectable, Logger } from '@nestjs/common';
import { CountryCode, PaymentMethod } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  MERCADOPAGO_ENVIRONMENTS,
  mercadoPagoSettingKeys,
  mercadoPagoWalletCheckoutSettingKeys,
  MercadoPagoEnvironment,
} from '../constants/payments-setting-keys.constants';
import {
  CardTokenCapability,
  ChargeCardCommand,
  ChargeCardResult,
  CreateWalletPreferenceCommand,
  PaymentProvider,
  PaymentProviderCapability,
  PaymentProviderNotConfiguredError,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  ProviderPaymentSnapshot,
  ProviderTransactionDetails,
  WalletPreferenceResult,
  WalletRedirectCapability,
} from '../ports/payment-provider.port';
import {
  MercadoPagoPaymentRecord,
  findPaymentRecordForOrder,
  mapPaymentRecordToDetails,
  mapPaymentRecordToSnapshot,
} from '../utils/mercadopago-payment-record.mapper';
import {
  MercadoPagoOrder,
  formatMercadoPagoAmount,
  mapOrderToSnapshot,
} from '../utils/mercadopago-order.mapper';
import { resolveMercadoPagoPaymentType } from '../utils/mercadopago-payment-type.util';
import {
  MercadoPagoPreferenceBackUrls,
  MercadoPagoPreferenceResponse,
  buildWalletPreferenceRequest,
  mapPreferenceResponse,
} from '../utils/mercadopago-preference.mapper';

// Mercado Pago tells sandbox from production by the CREDENTIAL, not the host.
const MERCADOPAGO_API_BASE_URL = 'https://api.mercadopago.com';

// A card authorization can legitimately take a few seconds (the live spike saw
// ~1.5s); this is only the ceiling before the outcome is treated as UNKNOWN.
const REQUEST_TIMEOUT_MS = 20_000;

// The details lookup is best-effort and runs right after a payment is approved:
// it must never make the Customer wait for it, so it gets a much shorter leash.
const DETAILS_TIMEOUT_MS = 4_000;

// Defensive: an order id is interpolated into a URL path, so refuse anything
// that isn't the plain alphanumeric shape Mercado Pago issues (`ORD…`).
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// GOS-142 — a Payments API id (used by the wallet flow) is purely numeric on
// the wire (e.g. `178687128941`), unlike an Orders API id — checked BEFORE
// `ORDER_ID_PATTERN` wherever both are possible, since a numeric string also
// matches that broader pattern.
const PAYMENT_ID_PATTERN = /^\d+$/;

interface MercadoPagoResponse {
  status: number;
  json: unknown;
}

interface Credentials {
  accessToken: string;
  environment: MercadoPagoEnvironment;
}

/**
 * `PaymentProvider` (+ `CardTokenCapability` and `WalletRedirectCapability`,
 * GOS-146) over Mercado Pago's **Orders API** (`POST /v1/orders`)
 * — NOT the legacy Payments API (`/v1/payments`), which Mercado Pago marks
 * legacy ("solo correcciones de seguridad y estabilidad"). A simple charge
 * into GoService's own account: no `marketplace_fee`/split, and NO
 * `capture_mode: manual` (DEC-009 / GOS-75 found neither dependable — the
 * 7-day retention is purely GoService's own ledger concept).
 *
 * Plain `fetch`, no SDK: GOS-75's PoC already drove the Orders API this way,
 * and an SDK adds a dependency with no demonstrated benefit here (a small,
 * deliberate departure from the ticket's "SDK oficial" wording).
 *
 * **Verified live against Mercado Pago's sandbox (GOS-85 spike, 2026-09-18,
 * Colombia app, `APP_USR-` test credentials)** — every behavior below marked
 * "live":
 * - approved card → `201`, `status: processed / accredited`, in ~1.5s, no
 *   redirect; re-read independently via `GET /v1/orders/{id}` and the legacy
 *   payments search;
 * - declined card → HTTP **`402`** (NOT a 2xx) whose body carries the order
 *   under `data` and the reason on `data.transactions.payments[0].status_detail`;
 * - `CONT` test card → `201`, `processing / in_process` (the pending case);
 * - `payment_method.id` and `payer` are REQUIRED (`400 required_properties`);
 * - the same `X-Idempotency-Key` returns the SAME order (no double charge);
 * - DEBIT cards: `type: "debit_card"` with `id` `debvisa`/`debmaster` and NO
 *   `installments` → `201`, `processed / accredited` in COP. For
 *   `debit_card` any other `id` is a `400` ("value must be one of 'debmaster',
 *   'debvisa'"). Caveat: the official Colombian debit test card
 *   (`4915 1120 5524 6507`) is NOT recognised by the sandbox at all (Mercado
 *   Pago's BIN lookup answers 404 "payment method not found", and the order is
 *   a generic `422`) — the debit charges above used the Argentine/Chilean/…
 *   debit test cards, whose BINs this Colombian account DOES recognise as
 *   `debvisa`/`debmaster`.
 * NOT verified live: Argentina/ARS (the only sandbox app is a Colombia one),
 * installments > 1, 3DS challenges (`action_required`), and the asynchronous
 * webhook.
 *
 * **GOS-142 (wallet payment) additions**: `getPaymentByPaymentId` and
 * `createWalletPreference` use TWO further Mercado Pago APIs — the legacy
 * Payments API (`GET /v1/payments/{id}`, a numeric id) and the Checkout
 * Preferences API (`POST /checkout/preferences` — no `/v1/` prefix, confirmed
 * live it 404s with one). Live-verified (GOS-142 spike, 2026-09-18/19): the
 * preferences endpoint path itself, that `unit_price` there is a PLAIN
 * INTEGER (not `formatMercadoPagoAmount`'s zero-decimal-string convention),
 * and that `purpose: 'wallet_purchase'` makes a funded Colombian test buyer's
 * checkout prominently offer account balance. NOT live-verified: a completed
 * wallet payment's `GET /v1/payments/{id}` shape (every live completion
 * attempt got stuck before the checkout resolved) and the wallet webhook
 * itself (no public HTTPS URL exists in any environment yet, same gap as the
 * `order` webhook) — `mapPaymentRecordToSnapshot`/`mapPaymentRecordStatus`
 * are written against Mercado Pago's documentation only.
 *
 * Reads its credentials from `PlatformSettingPort` on EVERY call (never
 * cached) — a credential rotated in the admin panel takes effect immediately.
 * Never logs the access token, the card token or the payer's email.
 *
 * **Per-country credentials (2026-09-18)**: a Mercado Pago account belongs to
 * exactly one country's marketplace — verified live that two different
 * "applications" under the same account owner still resolve to the SAME
 * single collector/country, so one credential pair cannot serve two
 * countries. Every call here takes a `country` (`CustomerProfile.country`)
 * and reads that country's own settings — see
 * `mercadoPagoSettingKeys`'s own header comment for the key shape.
 */
@Injectable()
export class MercadoPagoPaymentAdapter
  implements PaymentProvider, CardTokenCapability, WalletRedirectCapability
{
  private readonly logger = new Logger(MercadoPagoPaymentAdapter.name);

  /** GOS-146 — see `PaymentProvider.method`. */
  readonly method = PaymentMethod.MERCADOPAGO;
  readonly capabilities: ReadonlySet<PaymentProviderCapability> =
    new Set<PaymentProviderCapability>(['CARD_TOKEN', 'WALLET_REDIRECT']);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  /** GOS-146 — credentials + a valid environment for `country`. */
  async isConfigured(country: CountryCode): Promise<boolean> {
    try {
      await this.loadCredentials(country);
      return true;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        return false;
      }
      throw error;
    }
  }

  /** GOS-146 — the wallet flow's own extra config (public base URL + back URLs). */
  async isWalletConfigured(country: CountryCode): Promise<boolean> {
    try {
      await this.loadWalletCheckoutConfig(country);
      return true;
    } catch (error) {
      if (error instanceof PaymentProviderNotConfiguredError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * GOS-146 — re-reads a charge by `PaymentAttempt.providerPaymentId`,
   * whichever MERCADO PAGO API that id belongs to: a purely numeric id is a
   * legacy Payments API id (the wallet flow, `getPaymentByPaymentId`), anything
   * else an Orders API id (`ORD…`, the card flow, `getPayment`). This
   * order-vs-payment distinction is Mercado Pago's own business — it used to
   * live in `GetMyEngagementPaymentAttemptService`, and moved here so callers
   * dispatch by the attempt's METHOD, never by the id's shape.
   */
  readPayment(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null> {
    return PAYMENT_ID_PATTERN.test(providerPaymentId)
      ? this.getPaymentByPaymentId(providerPaymentId, country)
      : this.getPayment(providerPaymentId, country);
  }

  async chargeCard(command: ChargeCardCommand): Promise<ChargeCardResult> {
    // The card type is derived from the brand id the client's tokenization
    // reported (`debvisa`/`debmaster` are debit, everything else credit) — no
    // separate "card type" argument exists. Debit has no instalments: rather
    // than silently dropping a requested `installments > 1` (which would leave
    // the stored attempt claiming instalments that were never charged), it is
    // refused HERE, before any request is sent — a definitive "no charge".
    const paymentType = resolveMercadoPagoPaymentType(command.paymentMethodId);
    if (paymentType === 'debit_card' && command.installments !== 1) {
      throw new PaymentRequestRejectedError('INVALID_CARD_DATA');
    }

    const credentials = await this.loadCredentials(command.country);

    const response = await this.request('POST', '/v1/orders', credentials, {
      idempotencyKey: command.idempotencyKey,
      body: {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: command.externalReference,
        description: command.description,
        total_amount: formatMercadoPagoAmount(command.amount, command.currency),
        payer: { email: command.payerEmail },
        transactions: {
          payments: [
            {
              amount: formatMercadoPagoAmount(command.amount, command.currency),
              payment_method: {
                id: command.paymentMethodId,
                type: paymentType,
                token: command.cardToken,
                // Credit only — a debit card carries no instalments (omitted
                // on the wire, the form verified live).
                ...(paymentType === 'credit_card'
                  ? { installments: command.installments }
                  : {}),
              },
            },
          ],
        },
      },
    });

    const { status, json } = response;

    if (status >= 200 && status < 300) {
      const snapshot = mapOrderToSnapshot(json as MercadoPagoOrder | null);
      if (!snapshot) {
        // A 2xx without an order id: an order MAY exist — outcome unknown,
        // never assumed rejected.
        throw new PaymentProviderUnavailableError(
          'success response without an order id',
        );
      }
      return this.toChargeResult(snapshot, credentials.environment);
    }

    if (status === 402) {
      // A DECLINE, not an error: the order (and the reason) come back under
      // `data`.
      const order = (json as { data?: MercadoPagoOrder } | null)?.data;
      const snapshot = order ? mapOrderToSnapshot(order) : null;
      if (snapshot) {
        return this.toChargeResult(snapshot, credentials.environment);
      }
      throw new PaymentRequestRejectedError('OTHER');
    }

    if (status === 401 || status === 403) {
      this.logger.error({
        event: 'mercadopago_credentials_rejected',
        httpStatus: status,
        environment: credentials.environment,
      });
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }

    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      throw new PaymentProviderUnavailableError(`HTTP ${status}`);
    }

    // Any other 4xx: the provider refused the request and created no order.
    // 400 = OUR request was malformed (an integration bug, not the card);
    // 422 = unprocessable, most plausibly an invalid/expired/used card token.
    this.logger.error({
      event: 'mercadopago_charge_request_refused',
      httpStatus: status,
      errorCodes: this.extractErrorCodes(json),
      environment: credentials.environment,
    });
    throw new PaymentRequestRejectedError(
      status === 422
        ? 'INVALID_CARD_DATA'
        : status === 400
          ? 'PROVIDER_ERROR'
          : 'OTHER',
    );
  }

  async getPayment(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null> {
    if (!ORDER_ID_PATTERN.test(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials(country);
    const { status, json } = await this.request(
      'GET',
      `/v1/orders/${providerPaymentId}`,
      credentials,
    );

    if (status >= 200 && status < 300) {
      const snapshot = mapOrderToSnapshot(json as MercadoPagoOrder | null);
      if (!snapshot) {
        // A 2xx that carries no usable order is a provider fault, NOT "the
        // provider doesn't know this order" (that is the 404 below) — the
        // caller must not conclude the charge doesn't exist.
        throw new PaymentProviderUnavailableError(
          'success response without an order id',
        );
      }
      return snapshot;
    }
    if (status === 404) {
      return null;
    }
    if (status === 401 || status === 403) {
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    throw new PaymentProviderUnavailableError(`HTTP ${status}`);
  }

  /**
   * GOS-142 — the wallet flow's own source of truth (`GET /v1/payments/{id}`,
   * the legacy Payments API). See this class's own header comment and the
   * port's own comment on why `getPayment` (`/v1/orders/{id}`) cannot be
   * reused for a wallet payment. Same null/throw contract as `getPayment`.
   */
  async getPaymentByPaymentId(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null> {
    if (!PAYMENT_ID_PATTERN.test(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials(country);
    const { status, json } = await this.request(
      'GET',
      `/v1/payments/${providerPaymentId}`,
      credentials,
    );

    if (status >= 200 && status < 300) {
      const snapshot = mapPaymentRecordToSnapshot(
        json as MercadoPagoPaymentRecord | null,
      );
      if (!snapshot) {
        // A 2xx that carries no usable payment is a provider fault, NOT "the
        // provider doesn't know this payment" (that is the 404 below).
        throw new PaymentProviderUnavailableError(
          'success response without a payment id',
        );
      }
      return snapshot;
    }
    if (status === 404) {
      return null;
    }
    if (status === 401 || status === 403) {
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    throw new PaymentProviderUnavailableError(`HTTP ${status}`);
  }

  /**
   * GOS-142 — starts a wallet payment. See `PaymentProviderPort.createWalletPreference`'s
   * own comment for the throw contract; see this class's own header comment
   * for what was/wasn't verified live.
   */
  async createWalletPreference(
    command: CreateWalletPreferenceCommand,
  ): Promise<WalletPreferenceResult> {
    const credentials = await this.loadCredentials(command.country);
    const { backUrls, notificationUrl } = await this.loadWalletCheckoutConfig(
      command.country,
    );
    const { status, json } = await this.request(
      'POST',
      '/checkout/preferences',
      credentials,
      {
        body: buildWalletPreferenceRequest(command, backUrls, notificationUrl),
      },
    );

    if (status >= 200 && status < 300) {
      const result = mapPreferenceResponse(
        json as MercadoPagoPreferenceResponse | null,
        credentials.environment,
      );
      if (!result) {
        throw new PaymentProviderUnavailableError(
          'success response without a usable redirect URL',
        );
      }
      this.logger.log({
        event: 'mercadopago_wallet_preference_created',
        environment: credentials.environment,
        preferenceId: result.preferenceId,
      });
      return result;
    }
    if (status === 401 || status === 403) {
      this.logger.error({
        event: 'mercadopago_credentials_rejected',
        httpStatus: status,
        environment: credentials.environment,
      });
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    // No "rejected" outcome exists at this step (see the port's own
    // comment) — a malformed request here is GoService's own bug, not a
    // Customer-facing decline, so it surfaces the same as any other failure
    // to obtain a redirect URL.
    this.logger.error({
      event: 'mercadopago_wallet_preference_request_refused',
      httpStatus: status,
      errorCodes: this.extractErrorCodes(json),
      environment: credentials.environment,
    });
    throw new PaymentProviderUnavailableError(`HTTP ${status}`);
  }

  /**
   * The non-sensitive facts of an APPROVED payment (brand, last four, the
   * provider's fee/taxes/net, dates), from Mercado Pago's PAYMENT record —
   * the Orders API's own response does not carry them (verified live
   * 2026-09-18). The record is found through the payments search by the
   * `external_reference` sent at creation and linked to the order by its EXACT
   * id (`point_of_interaction.references[].id`); an amount/date match is never
   * used, so a wrong payment is never attributed.
   *
   * BEST-EFFORT by contract (see the port): a short timeout, and `null` when
   * the record isn't there yet. The caller treats every failure as "unknown".
   * Verified live for a Colombia credit payment; NOT verified for debit or
   * account-balance payments.
   */
  async getTransactionDetails(
    providerPaymentId: string,
    externalReference: string,
    country: CountryCode,
  ): Promise<ProviderTransactionDetails | null> {
    if (!externalReference) {
      return null;
    }
    // GOS-142: a WALLET id is a Payments API id already (see
    // `PAYMENT_ID_PATTERN`'s own comment on why this check comes first) — its
    // record is read DIRECTLY, no search needed.
    if (PAYMENT_ID_PATTERN.test(providerPaymentId)) {
      return this.getTransactionDetailsByPaymentId(
        providerPaymentId,
        externalReference,
        country,
      );
    }
    if (!ORDER_ID_PATTERN.test(providerPaymentId)) {
      return null;
    }
    const credentials = await this.loadCredentials(country);
    const { status, json } = await this.request(
      'GET',
      `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&status=approved&sort=date_approved&criteria=desc`,
      credentials,
      { timeoutMs: DETAILS_TIMEOUT_MS },
    );

    if (status === 401 || status === 403) {
      throw new PaymentProviderNotConfiguredError(
        'credentials rejected by the provider',
      );
    }
    if (status < 200 || status >= 300) {
      throw new PaymentProviderUnavailableError(`HTTP ${status}`);
    }
    const results = (json as { results?: MercadoPagoPaymentRecord[] } | null)
      ?.results;
    if (!Array.isArray(results)) {
      return null;
    }
    const record = findPaymentRecordForOrder(results, providerPaymentId);
    return record ? mapPaymentRecordToDetails(record) : null;
  }

  /**
   * GOS-142 — the wallet-payment branch of `getTransactionDetails`: reads
   * `GET /v1/payments/{id}` directly (no search, unlike the card flow — a
   * wallet `PaymentAttempt.providerPaymentId` is only ever set FROM a prior
   * `getPaymentByPaymentId` read, so the id is already known-good). The
   * `externalReference` match is still checked EXACTLY against the record's
   * own, never trusted by id alone — same "never attribute by amount/date"
   * rule `findPaymentRecordForOrder` documents for the card flow. NOT
   * live-verified — see this class's own header comment.
   */
  private async getTransactionDetailsByPaymentId(
    providerPaymentId: string,
    externalReference: string,
    country: CountryCode,
  ): Promise<ProviderTransactionDetails | null> {
    const credentials = await this.loadCredentials(country);
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
    const record = json as MercadoPagoPaymentRecord | null;
    if (!record || record.external_reference !== externalReference) {
      return null;
    }
    return mapPaymentRecordToDetails(record);
  }

  private toChargeResult(
    snapshot: ProviderPaymentSnapshot,
    environment: MercadoPagoEnvironment,
  ): ChargeCardResult {
    this.logger.log({
      event: 'mercadopago_charge_answered',
      environment,
      providerPaymentId: snapshot.providerPaymentId,
      status: snapshot.status,
      rejectionReason: snapshot.rejectionReason,
    });
    return {
      providerPaymentId: snapshot.providerPaymentId,
      status: snapshot.status,
      ...(snapshot.rejectionReason
        ? { rejectionReason: snapshot.rejectionReason }
        : {}),
    };
  }

  private async loadCredentials(country: CountryCode): Promise<Credentials> {
    const settingKeys = mercadoPagoSettingKeys(country);
    const accessToken = await this.platformSettingPort.getValue(
      settingKeys.accessToken,
    );
    if (!accessToken || accessToken.trim() === '') {
      throw new PaymentProviderNotConfiguredError(
        `access token missing for ${country}`,
      );
    }
    const environment = await this.platformSettingPort.getValue(
      settingKeys.environment,
    );
    if (
      !environment ||
      !(MERCADOPAGO_ENVIRONMENTS as readonly string[]).includes(environment)
    ) {
      throw new PaymentProviderNotConfiguredError(
        'environment must be "sandbox" or "production"',
      );
    }
    return {
      accessToken: accessToken.trim(),
      environment: environment as MercadoPagoEnvironment,
    };
  }

  /**
   * GOS-142 — see `mercadoPagoWalletCheckoutSettingKeys`'s own comment for
   * why these are GLOBAL settings, not per-country. Fails closed
   * (`PaymentProviderNotConfiguredError`) when any of the four rows is
   * missing/blank — none is seeded with a real value (no public HTTPS URL
   * exists in any environment yet).
   */
  private async loadWalletCheckoutConfig(country: CountryCode): Promise<{
    backUrls: MercadoPagoPreferenceBackUrls;
    notificationUrl: string;
  }> {
    const settingKeys = mercadoPagoWalletCheckoutSettingKeys();
    const [publicBaseUrl, success, pending, failure] = await Promise.all([
      this.platformSettingPort.getValue(settingKeys.publicBaseUrl),
      this.platformSettingPort.getValue(settingKeys.backUrlSuccess),
      this.platformSettingPort.getValue(settingKeys.backUrlPending),
      this.platformSettingPort.getValue(settingKeys.backUrlFailure),
    ]);
    if (!publicBaseUrl || publicBaseUrl.trim() === '') {
      throw new PaymentProviderNotConfiguredError('public base URL missing');
    }
    if (
      !success ||
      success.trim() === '' ||
      !pending ||
      pending.trim() === '' ||
      !failure ||
      failure.trim() === ''
    ) {
      throw new PaymentProviderNotConfiguredError('wallet back URLs missing');
    }
    const notificationUrl = `${publicBaseUrl.trim().replace(/\/+$/, '')}/webhooks/mercadopago/payments/${country.toLowerCase()}`;
    return {
      backUrls: {
        success: success.trim(),
        pending: pending.trim(),
        failure: failure.trim(),
      },
      notificationUrl,
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    credentials: Credentials,
    options?: { body?: unknown; idempotencyKey?: string; timeoutMs?: number },
  ): Promise<MercadoPagoResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    };
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options?.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetch(`${MERCADOPAGO_API_BASE_URL}${path}`, {
        method,
        headers,
        body:
          options?.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
        signal: AbortSignal.timeout(options?.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout / DNS / connection reset: the request may or may not have
      // been processed. The message is only the error's class name — never
      // its text, which could echo request details.
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

  private extractErrorCodes(json: unknown): string[] {
    const errors = (json as { errors?: { code?: unknown }[] } | null)?.errors;
    return Array.isArray(errors)
      ? errors
          .map((entry) => entry?.code)
          .filter((code): code is string => typeof code === 'string')
      : [];
  }
}
