import type { ProviderSavedCard } from '../ports/payment-provider.port';

/**
 * Pure mapping from a Mercado Pago CARD resource (the body of one entry of
 * `GET /v1/customers/{id}/cards`, or of `POST /v1/customers/{id}/cards`'s own
 * response) to `ProviderSavedCard` — same "kept separate from the adapter so
 * it's testable with zero NestJS/network machinery" reasoning as every other
 * mapper in this directory.
 *
 * NOT live-verified (GOS-149) — written against Mercado Pago's documented
 * Cards API shape only; see `MercadoPagoPaymentAdapter`'s own header comment.
 */

export interface MercadoPagoStoredCard {
  id?: string | null;
  last_four_digits?: string | null;
  expiration_month?: number | null;
  expiration_year?: number | null;
  payment_method?: {
    id?: string | null;
    payment_type_id?: string | null;
  } | null;
}

/**
 * `brand` is `payment_method.id` (e.g. `visa`, `master`) — the EXACT same id
 * shape `ChargeCardCommand.paymentMethodId`/`chargeCard` already expect, so a
 * `SavedPaymentCard.brand` read back later needs no translation to charge the
 * card again (see `ChargeSavedCardCommand.paymentMethodId`'s own comment).
 * Returns `null` (never throws) for a malformed entry — the caller filters
 * `null`s out rather than letting one bad card break the whole list.
 */
export function mapMercadoPagoStoredCard(
  json: unknown,
): ProviderSavedCard | null {
  const card = json as MercadoPagoStoredCard | null;
  if (!card || typeof card !== 'object' || !card.id) {
    return null;
  }
  const paymentTypeId = card.payment_method?.payment_type_id ?? null;
  return {
    providerCardId: card.id,
    brand: card.payment_method?.id ?? null,
    lastFour: card.last_four_digits ?? null,
    type:
      paymentTypeId === 'credit_card' || paymentTypeId === 'debit_card'
        ? paymentTypeId
        : null,
    expirationMonth: card.expiration_month ?? null,
    expirationYear: card.expiration_year ?? null,
  };
}
