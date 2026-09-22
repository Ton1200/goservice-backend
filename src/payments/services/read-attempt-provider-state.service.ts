import { Injectable } from '@nestjs/common';
import { CountryCode, PaymentAttempt } from '@prisma/client';
import { PaymentProviderRegistry } from '../payment-provider.registry';
import type {
  CardRejectionReason,
  ProviderCheckoutSnapshot,
  ProviderPaymentSnapshot,
} from '../ports/payment-provider.port';

/**
 * The provider's current view of ONE attempt, normalized across providers.
 * Superset of `ProviderPaymentSnapshot`: `providerPaymentId` may be null (an
 * embedded checkout can exist before any payment does) and it says whether a
 * payment was created and whether the Customer can still complete it.
 */
export interface AttemptProviderState {
  status: 'approved' | 'rejected' | 'pending';
  rejectionReason?: CardRejectionReason;
  providerPaymentId: string | null;
  externalReference: string | null;
  amount: number | null;
  currency: string | null;
  /** `true` once the provider created ANY payment for this attempt. */
  paymentCreated: boolean;
  /** `true` while the Customer can still complete it (a pending charge, or an open checkout). */
  open: boolean;
}

/** A provider CHECKOUT snapshot as the normalized attempt state. */
export function checkoutSnapshotToState(
  checkout: ProviderCheckoutSnapshot,
): AttemptProviderState {
  return {
    status: checkout.status,
    rejectionReason: checkout.rejectionReason,
    providerPaymentId: checkout.providerPaymentId,
    externalReference: checkout.externalReference,
    amount: checkout.amount,
    currency: checkout.currency,
    paymentCreated: checkout.paymentCreated,
    open: checkout.open,
  };
}

/** A provider PAYMENT snapshot as the normalized attempt state. */
export function paymentSnapshotToState(
  payment: ProviderPaymentSnapshot,
): AttemptProviderState {
  return {
    status: payment.status,
    rejectionReason: payment.rejectionReason,
    providerPaymentId: payment.providerPaymentId,
    externalReference: payment.externalReference,
    amount: payment.amount,
    currency: payment.currency,
    paymentCreated: true,
    open: payment.status === 'pending',
  };
}

/**
 * GOS-146 — re-reads a `PaymentAttempt`'s CURRENT state from the provider that
 * collected it, dispatching by `attempt.method` (never by the shape of an id):
 *
 * - an attempt with a `providerCheckoutId` whose provider supports embedded
 *   checkouts (Rapyd) is read through the CHECKOUT — it exists before any
 *   payment, so it works for an attempt with no `providerPaymentId` yet, and
 *   its status follows the "checkout decides" rule (see
 *   `ProviderCheckoutSnapshot`);
 * - otherwise an attempt with a `providerPaymentId` is read by that id
 *   (`PaymentProvider.readPayment`; Mercado Pago picks order-vs-payment API
 *   internally);
 * - an attempt with neither has nothing to re-read yet → `null`.
 *
 * Also `null` when the provider does not know the id. Provider errors
 * (`PaymentProviderUnavailableError`/`PaymentProviderNotConfiguredError`)
 * propagate: each caller decides whether that is best-effort (the read-time
 * reconciliation swallows it) or a real failure (the webhook lets it surface
 * as a 5xx so the provider retries).
 */
@Injectable()
export class ReadAttemptProviderStateService {
  constructor(private readonly registry: PaymentProviderRegistry) {}

  async read(
    attempt: PaymentAttempt,
    country: CountryCode,
  ): Promise<AttemptProviderState | null> {
    const provider = this.registry.forMethod(attempt.method);

    if (
      attempt.providerCheckoutId &&
      provider.capabilities.has('EMBEDDED_CHECKOUT')
    ) {
      const checkout = await this.registry
        .embeddedCheckout(attempt.method)
        .getCheckoutSnapshot(attempt.providerCheckoutId, country);
      if (!checkout) {
        return null;
      }
      return checkoutSnapshotToState(checkout);
    }

    if (attempt.providerPaymentId && provider.capabilities.has('SAVED_CARDS')) {
      // A PENDING attempt that has a payment id but no checkout can only be a
      // SERVER-SIDE saved-card charge (a checkout attempt gets its payment id
      // only when it is resolved). Nobody can retry that payment, so a failed
      // one is terminal (`readSavedCardCharge`), unlike one inside a checkout.
      const charge = await this.registry
        .savedCards(attempt.method)
        .readSavedCardCharge(attempt.providerPaymentId);
      return charge ? paymentSnapshotToState(charge) : null;
    }

    if (attempt.providerPaymentId) {
      const payment = await provider.readPayment(
        attempt.providerPaymentId,
        country,
      );
      if (!payment) {
        return null;
      }
      return paymentSnapshotToState(payment);
    }

    return null;
  }
}
