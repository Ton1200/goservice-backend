import { Injectable, Logger } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  MERCADOPAGO_ENVIRONMENTS,
  mercadoPagoSettingKeys,
  MercadoPagoEnvironment,
} from '../constants/payments-setting-keys.constants';
import {
  ChargeCardCommand,
  ChargeCardResult,
  PaymentProviderNotConfiguredError,
  PaymentProviderPort,
  PaymentProviderUnavailableError,
  PaymentRequestRejectedError,
  ProviderPaymentSnapshot,
  ProviderTransactionDetails,
} from '../ports/payment-provider.port';
import {
  MercadoPagoPaymentRecord,
  findPaymentRecordForOrder,
  mapPaymentRecordToDetails,
} from '../utils/mercadopago-payment-record.mapper';
import {
  MercadoPagoOrder,
  formatMercadoPagoAmount,
  mapOrderToSnapshot,
} from '../utils/mercadopago-order.mapper';
import { resolveMercadoPagoPaymentType } from '../utils/mercadopago-payment-type.util';

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

interface MercadoPagoResponse {
  status: number;
  json: unknown;
}

interface Credentials {
  accessToken: string;
  environment: MercadoPagoEnvironment;
}

/**
 * `PaymentProviderPort` over Mercado Pago's **Orders API** (`POST /v1/orders`)
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
export class MercadoPagoPaymentAdapter implements PaymentProviderPort {
  private readonly logger = new Logger(MercadoPagoPaymentAdapter.name);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

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
    if (!ORDER_ID_PATTERN.test(providerPaymentId) || !externalReference) {
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
