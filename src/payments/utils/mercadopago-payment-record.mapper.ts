import type {
  CardRejectionReason,
  ProviderPaymentSnapshot,
  ProviderTransactionDetails,
} from '../ports/payment-provider.port';

/**
 * Pure mapping from a Mercado Pago PAYMENT resource — the SAME shape whether
 * it arrives as an entry of `GET /v1/payments/search` (used for the
 * best-effort card-payment details read) or as the body of a direct
 * `GET /v1/payments/{id}` (used, since GOS-142, as the wallet flow's own
 * status source of truth — see `mapPaymentRecordToSnapshot`/
 * `mapPaymentRecordStatus` below). The shape below is copied from a REAL
 * sandbox payment (GOS-85, 2026-09-18, Colombia); only the fields read here
 * are declared.
 *
 * Only what is needed to follow a payment and to show the Customer what they
 * paid with is ever read. Deliberately NOT read (they are in the record, and
 * are not needed): the cardholder's name/document, the payer's phone, the card's
 * first six digits.
 */
export interface MercadoPagoPaymentRecord {
  /** Numeric in the real API (e.g. `178687128941`) — read as a string here so `String(id)` is never forgotten at the one call site that needs it. */
  id?: number | string | null;
  status?: string | null;
  status_detail?: string | null;
  external_reference?: string | null;
  /** A plain NUMBER (unlike the Orders API's zero-decimal-string `total_amount`) — GOS-142, statically reviewed from documentation, not live-verified end to end. */
  transaction_amount?: number | null;
  currency_id?: string | null;
  payment_type_id?: string | null;
  payment_method_id?: string | null;
  card?: { last_four_digits?: string | null } | null;
  charges_details?:
    | {
        type?: string;
        accounts?: { from?: string; to?: string };
        amounts?: { original?: number };
      }[]
    | null;
  fee_details?: { type?: string; fee_payer?: string; amount?: number }[] | null;
  transaction_details?: { net_received_amount?: number | null } | null;
  date_approved?: string | null;
  money_release_date?: string | null;
  point_of_interaction?: { references?: { id?: string }[] } | null;
}

function toWholeUnits(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Only a plain 4-digit string is kept — never anything longer that could be more of the card number. */
function toLastFour(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : null;
}

/**
 * What Mercado Pago charged GoService (the COLLECTOR) for this payment.
 * `charges_details` is the authoritative breakdown: a `fee` and one or more
 * `tax` withholdings, each `from: collector`. Charges that come from the PAYER
 * (e.g. the financing cost of instalments the buyer pays) are excluded — they
 * are not GoService's cost. `fee_details` is the older, fee-only fallback.
 */
function sumCollectorCharges(
  record: MercadoPagoPaymentRecord,
  kind: 'fee' | 'tax',
): number | null {
  if (record.charges_details && record.charges_details.length > 0) {
    const relevant = record.charges_details.filter(
      (charge) => charge.type === kind && charge.accounts?.from === 'collector',
    );
    return relevant.reduce(
      (total, charge) => total + Math.round(charge.amounts?.original ?? 0),
      0,
    );
  }
  if (kind === 'fee' && record.fee_details && record.fee_details.length > 0) {
    return record.fee_details
      .filter((fee) => fee.fee_payer === 'collector')
      .reduce((total, fee) => total + Math.round(fee.amount ?? 0), 0);
  }
  return null;
}

/** The payment record that belongs to a given Orders API order — an EXACT link, never a guess by amount. */
export function findPaymentRecordForOrder(
  records: MercadoPagoPaymentRecord[],
  orderId: string,
): MercadoPagoPaymentRecord | null {
  return (
    records.find((record) =>
      record.point_of_interaction?.references?.some(
        (reference) => reference.id === orderId,
      ),
    ) ?? null
  );
}

export function mapPaymentRecordToDetails(
  record: MercadoPagoPaymentRecord,
): ProviderTransactionDetails {
  const isCard =
    record.payment_type_id === 'credit_card' ||
    record.payment_type_id === 'debit_card';
  return {
    paymentTypeId: record.payment_type_id ?? null,
    // The brand and last four only make sense for a card; a payment made with
    // account balance has neither.
    cardBrand: isCard ? (record.payment_method_id ?? null) : null,
    cardLastFour: isCard ? toLastFour(record.card?.last_four_digits) : null,
    providerFeeAmount: sumCollectorCharges(record, 'fee'),
    providerTaxAmount: sumCollectorCharges(record, 'tax'),
    netReceivedAmount: toWholeUnits(
      record.transaction_details?.net_received_amount,
    ),
    approvedAt: toDate(record.date_approved),
    moneyReleaseAt: toDate(record.money_release_date),
  };
}

// --- Below: added for GOS-142 (wallet payment). The Payments API
// (`GET /v1/payments/{id}`) is now read directly as this SAME
// `MercadoPagoPaymentRecord` shape — see that field's own comment — so its
// status/rejection mapping lives here, next to the interface it maps,
// mirroring `mapOrderStatus`/`mapRejectionReason` in
// `mercadopago-order.mapper.ts` (the Orders API's equivalent pair). NONE of
// this was live-verified: every live wallet-checkout completion attempt
// during the GOS-142 spike (2026-09-18/19) got stuck before a payment
// resolved — see the plan's own "Fase 0" notes. Written against Mercado
// Pago's documented Payments API status vocabulary only.

type PaymentRecordStatus = 'approved' | 'rejected' | 'pending';

/**
 * The Payments API's OWN status vocabulary (`approved`, `pending`,
 * `authorized`, `in_process`, `in_mediation`, `rejected`, `cancelled`,
 * `refunded`, `charged_back`) is DIFFERENT from the Orders API's
 * (`processed`/`failed`/`processing`/`created`/`action_required`/`canceled`/
 * `expired` — see `mapOrderStatus`) — not a copy-paste of that function.
 *
 * `refunded`/`charged_back` are deliberately left mapped to `pending`, same
 * as any other unrecognized value: refunds/chargebacks are explicitly out of
 * scope for GOS-142 (no refund flow exists yet), so this adapter must never
 * report a reversed payment as still `approved`, but also must never invent a
 * `rejected` outcome for a charge that DID succeed at some point. Same
 * "never move money-relevant state on an unrecognized status" philosophy as
 * `mapOrderStatus` above.
 */
export function mapPaymentRecordStatus(
  record: MercadoPagoPaymentRecord,
): PaymentRecordStatus {
  const status = record.status?.toLowerCase();
  if (status === 'approved') {
    return 'approved';
  }
  if (status === 'rejected' || status === 'cancelled') {
    return 'rejected';
  }
  return 'pending';
}

/**
 * `status_detail` → the same small stable DOMAIN vocabulary
 * `mapRejectionReason` (Orders API) produces, from Mercado Pago's documented
 * `cc_rejected_*` detail family for the legacy Payments API — NOT
 * live-verified (no wallet payment reached a REJECTED state during the
 * GOS-142 spike). The raw detail is never surfaced or stored.
 */
export function mapPaymentRecordRejectionReason(
  statusDetail: string | null | undefined,
): CardRejectionReason {
  const value = statusDetail?.toLowerCase() ?? '';
  if (value.includes('insufficient')) {
    return 'INSUFFICIENT_FUNDS';
  }
  if (value.includes('bad_filled')) {
    return 'INVALID_CARD_DATA';
  }
  if (
    value.includes('card_disabled') ||
    value.includes('max_attempts') ||
    value.includes('call_for_authorize') ||
    value.includes('duplicated_payment') ||
    value.includes('high_risk') ||
    value.includes('blacklist')
  ) {
    return 'CARD_DECLINED';
  }
  return 'OTHER';
}

/**
 * A full `MercadoPagoPaymentRecord` (the body of `GET /v1/payments/{id}`) →
 * `ProviderPaymentSnapshot` — the wallet flow's equivalent of `mapOrderToSnapshot`.
 * Returns `null` when the record has no id (a malformed body). `id` is
 * numeric on the wire; stringified here so `ProviderPaymentSnapshot.providerPaymentId`
 * stays a plain string everywhere else in this module.
 */
export function mapPaymentRecordToSnapshot(
  record: MercadoPagoPaymentRecord | null | undefined,
): ProviderPaymentSnapshot | null {
  if (
    !record ||
    typeof record !== 'object' ||
    record.id === undefined ||
    record.id === null
  ) {
    return null;
  }
  const status = mapPaymentRecordStatus(record);
  return {
    providerPaymentId: String(record.id),
    status,
    ...(status === 'rejected'
      ? {
          rejectionReason: mapPaymentRecordRejectionReason(
            record.status_detail,
          ),
        }
      : {}),
    externalReference: record.external_reference ?? null,
    amount: toWholeUnits(record.transaction_amount),
    currency: record.currency_id ?? null,
  };
}
