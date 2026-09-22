import type {
  CardRejectionReason,
  ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';

/**
 * Pure mapping between Mercado Pago's Orders API wire format and this
 * module's provider-agnostic types — kept separate from
 * `MercadoPagoPaymentAdapter` so it is testable with zero NestJS/network
 * machinery.
 *
 * Every shape and value below marked "live" was observed against Mercado
 * Pago's sandbox during the GOS-85 spike (2026-09-18, Colombia app,
 * `APP_USR-` test credentials); the rest comes from Mercado Pago's own
 * documentation and is called out as such.
 */

export interface MercadoPagoPayment {
  id?: string;
  status?: string;
  status_detail?: string;
}

export interface MercadoPagoOrder {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  currency?: string;
  transactions?: { payments?: MercadoPagoPayment[] };
}

type ChargeStatus = 'approved' | 'rejected' | 'pending';

/**
 * Currencies Mercado Pago handles as ZERO-DECIMAL amount strings.
 *
 * COP: live — `total_amount: "1000.00"` was answered 400 "does not match
 * pattern"; `"50000"` was accepted. ARS: NOT verified live (the only sandbox
 * application available is a Colombia one) — its `"200.00"` two-decimal form
 * comes from Mercado Pago's documented Orders API examples, so ARS charging is
 * statically reviewed only.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['COP', 'CLP', 'PYG', 'UYI']);

/** `50000` + `COP` → `"50000"`; `50000` + `ARS` → `"50000.00"`. */
export function formatMercadoPagoAmount(
  amount: number,
  currency: string,
): string {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
    ? String(Math.trunc(amount))
    : amount.toFixed(2);
}

/** Inverse of `formatMercadoPagoAmount` — `null` for anything unparseable. */
export function parseMercadoPagoAmount(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Order-level `status` → this module's 3-state result.
 *
 * Live: `processed` (+ `accredited`) = paid; `failed` = declined;
 * `processing` (+ `in_process`) = the pending case (test cardholder `CONT`).
 * From the docs: `canceled`/`expired` are terminal non-payments; `created`,
 * `action_required` (e.g. a 3DS challenge) are still open.
 *
 * **Anything unrecognized maps to `pending`, never `approved`/`rejected`** —
 * an unknown state must not move money-relevant state; the notification
 * handler re-reads and will resolve it once Mercado Pago reports a known one.
 * `processed` WITHOUT `accredited` is likewise not treated as paid.
 */
export function mapOrderStatus(order: MercadoPagoOrder): ChargeStatus {
  const status = order.status?.toLowerCase();
  if (status === 'processed') {
    return order.status_detail?.toLowerCase() === 'accredited'
      ? 'approved'
      : 'pending';
  }
  if (status === 'failed' || status === 'canceled' || status === 'expired') {
    return 'rejected';
  }
  return 'pending';
}

/**
 * The payment's `status_detail` → a small stable DOMAIN reason. Live values:
 * `insufficient_amount` (test cardholder `FUND`), `rejected_by_issuer`
 * (`OTHE`). The other buckets follow Mercado Pago's documented detail
 * families and are NOT individually verified live.
 *
 * The raw detail is deliberately NEVER surfaced or stored — only this
 * bucketed reason (no processor internals leak to the client).
 */
export function mapRejectionReason(
  detail: string | undefined,
): CardRejectionReason {
  const value = detail?.toLowerCase() ?? '';
  if (value === 'insufficient_amount') {
    return 'INSUFFICIENT_FUNDS';
  }
  if (value.startsWith('bad_filled')) {
    return 'INVALID_CARD_DATA';
  }
  if (
    value.startsWith('rejected') ||
    value === 'card_disabled' ||
    value === 'max_attempts_exceeded' ||
    value === 'blacklist'
  ) {
    return 'CARD_DECLINED';
  }
  return 'OTHER';
}

/**
 * The reason lives on the PAYMENT (`transactions.payments[0].status_detail`,
 * live: `insufficient_amount`) — the order-level `status_detail` of a
 * declined order is just the literal `failed`, which says nothing.
 */
function paymentDetail(order: MercadoPagoOrder): string | undefined {
  return (
    order.transactions?.payments?.[0]?.status_detail ?? order.status_detail
  );
}

/**
 * A full `MercadoPagoOrder` (the body of a 201 create, of `GET
 * /v1/orders/{id}`, or of the `data` node inside a 402 decline) →
 * `ProviderPaymentSnapshot`. Returns `null` when the order has no id (a
 * malformed body — the caller decides what that means).
 */
export function mapOrderToSnapshot(
  order: MercadoPagoOrder | null | undefined,
): ProviderPaymentSnapshot | null {
  // Defensive: the body comes off the wire, so a `null`/empty/non-object 2xx
  // body must yield `null` ("no usable order"), never a TypeError.
  if (!order || typeof order !== 'object' || !order.id) {
    return null;
  }
  const status = mapOrderStatus(order);
  return {
    providerPaymentId: order.id,
    status,
    ...(status === 'rejected'
      ? { rejectionReason: mapRejectionReason(paymentDetail(order)) }
      : {}),
    externalReference: order.external_reference ?? null,
    amount: parseMercadoPagoAmount(order.total_amount),
    currency: order.currency ?? null,
  };
}
