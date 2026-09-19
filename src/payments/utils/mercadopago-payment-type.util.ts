/**
 * Which Orders API `payment_method.type` a card's `payment_method.id` belongs
 * to. The client never sends a "card type": the id its tokenization reports
 * already carries it — Mercado Pago's own API states that for
 * `type: "debit_card"` the id must be one of `debmaster` / `debvisa` (a
 * `400 property_value` — "value must be one of 'debmaster', 'debvisa'" — for
 * anything else, observed live 2026-09-18), while credit brands are `visa`,
 * `master`, `amex`, `diners`, `codensa`, `naranja`, ...
 *
 * Deliberately a closed allow-list of the two debit ids, not a `deb*` prefix
 * match: an unrecognised id falls through to `credit_card`, where Mercado Pago
 * itself rejects it if wrong — GoService never guesses that a new id is debit.
 * Prepaid cards (`visa`/`master` with type `prepaid_card`) share the credit
 * ids and are NOT supported by this path.
 */
export type MercadoPagoPaymentType = 'credit_card' | 'debit_card';

const DEBIT_PAYMENT_METHOD_IDS: ReadonlySet<string> = new Set([
  'debvisa',
  'debmaster',
]);

export function resolveMercadoPagoPaymentType(
  paymentMethodId: string,
): MercadoPagoPaymentType {
  return DEBIT_PAYMENT_METHOD_IDS.has(paymentMethodId.toLowerCase())
    ? 'debit_card'
    : 'credit_card';
}
