import type {
  CardRejectionReason,
  ProviderCheckoutSnapshot,
  ProviderSavedCard,
  ProviderPaymentSnapshot,
  ProviderTransactionDetails,
} from '../ports/payment-provider.port';
import { roundToMajorUnits } from './payment-snapshot-consistency.util';

/**
 * Pure mapping between Rapyd's wire format and this module's provider-agnostic
 * types — kept separate from `RapydPaymentAdapter` so it is testable with zero
 * NestJS/network machinery (same posture as `mercadopago-order.mapper.ts`).
 *
 * Evidence levels, so no claim outruns its source:
 * - **live** (GOS-75 PoC, Rapyd sandbox, `evidence.md`): a checkout is `NEW`
 *   with an empty nested `payment` (`id: null`, `status: null`, `paid: false`)
 *   until the widget submits; after a completed payment the checkout is `DON`
 *   and the payment is `CLO` with `paid: true`; a payment awaiting 3D Secure is
 *   `ACT` with `paid: false`, `next_action: '3d_verification'`.
 * - **docs** (docs.rapyd.net, "Retrieve Checkout Page" / "Create Checkout
 *   Page"): checkout `status` is `NEW` | `DON` | `EXP` | `INP` (payment
 *   creation in progress) | `DEC` (Rapyd Protect blocked the payment).
 * - **live, GOS-146 (2026-09-21, Colombia sandbox)**: the checkout response has
 *   NO top-level `merchant_reference_id` (the docs say it does) — the reference
 *   we sent comes back on the NESTED `payment`, even before a payment exists
 *   (`payment.id` null). `mapCheckoutToSnapshot` reads both.
 * - **NOT verified anywhere**: any failed/cancelled/expired PAYMENT (`ERR`,
 *   `CAN`, `EXP`) and its `failure_code` values, and the exact names of the
 *   card brand / last four / card type inside `payment_method_data`. Those
 *   mappings are written defensively (unknown → `OTHER`/`null`) and are called
 *   out as TBD in the GOS-146 report.
 */

export interface RapydPayment {
  id?: string | null;
  status?: string | null;
  paid?: boolean | null;
  amount?: number | string | null;
  currency_code?: string | null;
  merchant_reference_id?: string | null;
  failure_code?: string | null;
  payment_method_type?: string | null;
  payment_method_type_category?: string | null;
  payment_method_data?: Record<string, unknown> | null;
  payment_fees?: unknown;
  paid_at?: number | string | null;
  next_action?: string | null;
  redirect_url?: string | null;
}

/** A card of a Rapyd customer's vault (`GET /v1/customers/{id}/payment_methods`). */
export interface RapydStoredCard {
  id?: string | null;
  category?: string | null;
  last4?: string | null;
  bin_details?: Record<string, unknown> | null;
  expiration_month?: string | number | null;
  expiration_year?: string | number | null;
}

export interface RapydCheckout {
  id?: string | null;
  status?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  merchant_reference_id?: string | null;
  payment?: RapydPayment | null;
}

/** Rapyd wraps every response in `{ status: {...}, data: {...} }`. */
export interface RapydEnvelope<T> {
  status?: { status?: string; error_code?: string; message?: string } | null;
  data?: T | null;
}

const CHECKOUT_ID_PATTERN = /^checkout_[A-Za-z0-9]+$/;
const PAYMENT_ID_PATTERN = /^payment_[A-Za-z0-9]+$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]+$/;
const STORED_CARD_ID_PATTERN = /^card_[A-Za-z0-9]+$/;

export function isRapydCheckoutId(value: string): boolean {
  return CHECKOUT_ID_PATTERN.test(value);
}

export function isRapydPaymentId(value: string): boolean {
  return PAYMENT_ID_PATTERN.test(value);
}

export function isRapydCustomerId(value: string): boolean {
  return CUSTOMER_ID_PATTERN.test(value);
}

export function isRapydStoredCardId(value: string): boolean {
  return STORED_CARD_ID_PATTERN.test(value);
}

/** The `data` node of a Rapyd envelope, or `null` when absent/not an object. */
export function unwrapRapydData<T>(json: unknown): T | null {
  const data = (json as RapydEnvelope<T> | null)?.data;
  return data && typeof data === 'object' ? data : null;
}

/** Rapyd's own machine-readable error code from the envelope — for LOGS only. */
export function extractRapydErrorCode(json: unknown): string | null {
  const code = (json as RapydEnvelope<unknown> | null)?.status?.error_code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/**
 * A payment is PAID only when it is `CLO` AND `paid: true` — the evidence of
 * the GOS-75 PoC. Anything less (`ACT` awaiting 3DS, `CLO` without `paid`, an
 * unknown status) is NOT paid: an unrecognized state must never move money.
 */
export function isRapydPaymentPaid(
  payment: RapydPayment | null | undefined,
): boolean {
  return payment?.status?.toUpperCase() === 'CLO' && payment.paid === true;
}

/**
 * Rapyd's `failure_code` → a small stable DOMAIN reason. Rapyd's failure codes
 * were never observed for a real failure (see this file's header): only the
 * obvious families are recognized, everything else is `OTHER`. The raw code is
 * deliberately NEVER surfaced or stored.
 */
export function mapRapydFailureCode(
  code: string | null | undefined,
): CardRejectionReason {
  const value = code?.toUpperCase() ?? '';
  if (value.includes('INSUFFICIENT')) {
    return 'INSUFFICIENT_FUNDS';
  }
  if (
    value.includes('DECLINE') ||
    value.includes('DO_NOT_HONOR') ||
    value.includes('REFUSED')
  ) {
    return 'CARD_DECLINED';
  }
  if (
    value.includes('INVALID_CARD') ||
    value.includes('CVV') ||
    value.includes('EXPIRED_CARD')
  ) {
    return 'INVALID_CARD_DATA';
  }
  return 'OTHER';
}

/**
 * A full Rapyd CHECKOUT (the `data` of `GET /v1/checkout/{id}` or of the create
 * call) → `ProviderCheckoutSnapshot`. Returns `null` when it has no usable id.
 *
 * **The checkout decides the status** (see `ProviderCheckoutSnapshot`):
 * - `approved` — the nested payment is `CLO` + `paid: true`;
 * - `rejected` — the checkout itself ended without a payment: `EXP` (expired)
 *   or `DEC` (blocked by Rapyd Protect);
 * - `pending` — everything else, INCLUDING a failed payment inside a checkout
 *   that is still `NEW`/`INP`: the embedded widget lets the Customer retry
 *   inside the same checkout (Rapyd allows several attempts), so closing the
 *   GoService attempt on the first failure would lose a successful retry —
 *   the Customer charged, no ledger event.
 *
 * `amount`/`currency` are what was actually PAID (the nested payment's) when
 * approved, otherwise the checkout's own; amounts are rounded to whole major
 * units (Rapyd can answer decimals — ARS — and `LedgerEntry.amount` is an
 * integer).
 */
export function mapCheckoutToSnapshot(
  checkout: RapydCheckout | null | undefined,
): ProviderCheckoutSnapshot | null {
  if (
    !checkout ||
    typeof checkout !== 'object' ||
    !checkout.id ||
    !isRapydCheckoutId(checkout.id)
  ) {
    return null;
  }
  const payment = checkout.payment ?? null;
  const paid = isRapydPaymentPaid(payment);
  const checkoutStatus = checkout.status?.toUpperCase() ?? '';
  const terminalWithoutPayment =
    !paid && (checkoutStatus === 'EXP' || checkoutStatus === 'DEC');

  const status: ProviderCheckoutSnapshot['status'] = paid
    ? 'approved'
    : terminalWithoutPayment
      ? 'rejected'
      : 'pending';

  return {
    checkoutId: checkout.id,
    status,
    ...(status === 'rejected'
      ? { rejectionReason: mapRapydFailureCode(payment?.failure_code) }
      : {}),
    providerPaymentId: payment?.id ? payment.id : null,
    paymentCreated: Boolean(payment?.id),
    open: !paid && !terminalWithoutPayment,
    externalReference:
      checkout.merchant_reference_id ?? payment?.merchant_reference_id ?? null,
    amount: roundToMajorUnits(paid ? payment?.amount : checkout.amount),
    currency: (paid ? payment?.currency_code : checkout.currency) ?? null,
  };
}

/**
 * A Rapyd PAYMENT (`GET /v1/payments/{id}`) → `ProviderPaymentSnapshot`.
 * Returns `null` when it has no usable id.
 *
 * `approved` only for `CLO` + `paid: true`; EVERYTHING else is `pending` —
 * deliberately never `rejected`. A failed payment does not end a Rapyd
 * attempt (the checkout may still be open and retried, see
 * `mapCheckoutToSnapshot`); only the CHECKOUT can. This snapshot is used to
 * correlate a notification and to approve; a rejection always comes from the
 * checkout.
 */
export function mapPaymentToSnapshot(
  payment: RapydPayment | null | undefined,
): ProviderPaymentSnapshot | null {
  if (
    !payment ||
    typeof payment !== 'object' ||
    !payment.id ||
    !isRapydPaymentId(payment.id)
  ) {
    return null;
  }
  return {
    providerPaymentId: payment.id,
    status: isRapydPaymentPaid(payment) ? 'approved' : 'pending',
    externalReference: payment.merchant_reference_id ?? null,
    amount: roundToMajorUnits(payment.amount),
    currency: payment.currency_code ?? null,
  };
}

function toLastFour(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim().toLowerCase()
    : null;
}

function toDate(value: unknown): Date | null {
  const seconds = typeof value === 'string' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : null;
}

/**
 * BEST-EFFORT facts of a PAID Rapyd payment (brand, last four, card type).
 * Every field is nullable and a wrong guess of Rapyd's field names only costs
 * a null — never a failed payment (the caller treats any failure as "unknown").
 * The card TYPE (`credit_card`/`debit_card`, the vocabulary
 * `PaymentAttempt.type` maps) is read from `bin_details.type` (`CREDIT`/`DEBIT`)
 * when Rapyd reports it; if it does not, `paymentTypeId` stays null (same
 * criterion as a wallet payment). Rapyd's fee is not exposed on the payment in
 * any shape observed (`payment_fees` was `null`), so fees/net stay null.
 *
 * **Verified live (GOS-146, 2026-09-21, Colombia sandbox, a paid VISA test card)**:
 * `payment_method_data.last4` ("1111"), `payment_method_data.bin_details` =
 * `{ type: 'DEBIT', brand: 'VISA', level, issuer, country, bin_number }` (NOTE: `type`,
 * not `card_type`; the brand is on `bin_details`, not on `payment_method_data`),
 * `paid_at` (unix seconds), `payment_fees: null`, top-level `payment_method_type`
 * (`co_visa_m_card`) and `payment_method_type_category` (`card`). The other
 * field-name fallbacks below are defensive guesses for other providers'/countries'
 * shapes and were never observed.
 */
export function mapPaymentToDetails(
  payment: RapydPayment,
): ProviderTransactionDetails {
  const data = payment.payment_method_data ?? {};
  const bin = (data['bin_details'] ?? {}) as Record<string, unknown>;
  const cardType = toStringOrNull(
    bin['type'] ?? bin['card_type'] ?? data['card_type'],
  );
  return {
    paymentTypeId:
      cardType === 'credit'
        ? 'credit_card'
        : cardType === 'debit'
          ? 'debit_card'
          : null,
    cardBrand: toStringOrNull(
      bin['card_brand'] ??
        bin['brand'] ??
        data['brand'] ??
        data['network'] ??
        data['card_brand'],
    ),
    cardLastFour: toLastFour(data['last4'] ?? data['last_4']),
    providerFeeAmount: null,
    providerTaxAmount: null,
    netReceivedAmount: null,
    approvedAt: toDate(payment.paid_at),
    moneyReleaseAt: null,
  };
}

/** The `data` of `GET /v1/customers/{id}/payment_methods` is an ARRAY (not an object). */
export function unwrapRapydList<T>(json: unknown): T[] {
  const data = (json as RapydEnvelope<unknown> | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * A stored card → non-sensitive facts. Returns `null` for anything that is not
 * a card (the customer's vault can also hold other payment-method types) or has
 * no usable `card_…` token id. **Verified live (GOS-146, 2026-09-21, Argentina
 * sandbox)**: `last4` ("1111"), `bin_details.brand` ("VISA") / `.type`
 * ("DEBIT"), `expiration_month` ("12") and `expiration_year` ("30" — TWO digits,
 * a string; read as 20xx). The PAN, CVV and holder name are never read.
 */
export function mapRapydStoredCard(
  card: RapydStoredCard | null | undefined,
): ProviderSavedCard | null {
  if (
    !card ||
    typeof card !== 'object' ||
    !card.id ||
    !isRapydStoredCardId(card.id) ||
    (card.category && card.category !== 'card')
  ) {
    return null;
  }
  const bin = card.bin_details ?? {};
  const cardType = toStringOrNull(bin['type']);
  const month = Number(card.expiration_month);
  const rawYear = Number(card.expiration_year);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return {
    providerCardId: card.id,
    brand: toStringOrNull(bin['brand'] ?? bin['card_brand']),
    lastFour: toLastFour(card.last4),
    type:
      cardType === 'credit'
        ? 'credit_card'
        : cardType === 'debit'
          ? 'debit_card'
          : null,
    expirationMonth:
      Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    expirationYear:
      Number.isInteger(year) && year >= 2000 && year <= 2999 ? year : null,
  };
}

const FAILED_PAYMENT_STATUSES = new Set(['ERR', 'CAN', 'EXP']);

/**
 * A payment made SERVER-SIDE with a stored card (`POST /v1/payments` with a
 * card token, or a later re-read of it) → `ProviderPaymentSnapshot`. Unlike a
 * payment inside a checkout (`mapPaymentToSnapshot`, which never rejects
 * because the widget lets the Customer retry), nobody can retry this one, so:
 * - `CLO` + `paid: true` → `approved`;
 * - `ERR` / `CAN` / `EXP` → `rejected` (reason from `failure_code`);
 * - `ACT` + `next_action: '3d_verification'` → `rejected` with
 *   `AUTHENTICATION_REQUIRED` (the issuer wants the Customer to authenticate;
 *   the adapter cancels the payment so it cannot be completed later unseen);
 * - anything else (`ACT` for another reason, an unknown status) → `pending`.
 * Only the sandbox's `CLO`/`paid` was observed live for a stored card; the
 * failure statuses follow Rapyd's documented payment statuses.
 */
export function mapSavedCardCharge(
  payment: RapydPayment | null | undefined,
): ProviderPaymentSnapshot | null {
  if (
    !payment ||
    typeof payment !== 'object' ||
    !payment.id ||
    !isRapydPaymentId(payment.id)
  ) {
    return null;
  }
  const status = payment.status?.toUpperCase() ?? '';
  const base = {
    providerPaymentId: payment.id,
    externalReference: payment.merchant_reference_id ?? null,
    amount: roundToMajorUnits(payment.amount),
    currency: payment.currency_code ?? null,
  };
  if (isRapydPaymentPaid(payment)) {
    return { ...base, status: 'approved' };
  }
  if (status === 'ACT' && payment.next_action === '3d_verification') {
    return {
      ...base,
      status: 'rejected',
      rejectionReason: 'AUTHENTICATION_REQUIRED',
    };
  }
  if (FAILED_PAYMENT_STATUSES.has(status)) {
    return {
      ...base,
      status: 'rejected',
      rejectionReason: mapRapydFailureCode(payment.failure_code),
    };
  }
  return { ...base, status: 'pending' };
}
