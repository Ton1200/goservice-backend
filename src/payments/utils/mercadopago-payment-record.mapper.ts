import type { ProviderTransactionDetails } from '../ports/payment-provider.port';

/**
 * Pure mapping from a Mercado Pago PAYMENT record (an entry of
 * `GET /v1/payments/search`) to the non-sensitive facts GoService keeps about
 * how a payment was made. The shape below is copied from a REAL sandbox payment
 * (GOS-85, 2026-09-18, Colombia); only the fields read here are declared.
 *
 * Only what is needed to follow a payment and to show the Customer what they
 * paid with is ever read. Deliberately NOT read (they are in the record, and
 * are not needed): the cardholder's name/document, the payer's phone, the card's
 * first six digits.
 */
export interface MercadoPagoPaymentRecord {
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
