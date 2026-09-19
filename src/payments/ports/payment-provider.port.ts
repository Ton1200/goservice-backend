import { CountryCode } from '@prisma/client';

/**
 * Provider-agnostic seam for charging a card — same Port/Adapter shape as
 * `StoragePort`/`SessionPort`/`EmailClientPort`/`IdentityVerificationPort`.
 * Its only implementation today is `MercadoPagoPaymentAdapter` (Mercado Pago's
 * Orders API); a future second provider is one new class + one `useExisting`
 * change in `PaymentsModule`, never a resolver/service/schema change.
 * (Saved-card tokenization, GOS-83, was dropped 2026-09-18: Mercado Pago has no
 * reusable token — see domain-model.md. The follow-up "pay with a Mercado Pago
 * account" story is also built on this port.)
 *
 * **Scope, deliberately narrow (GOS-85, DEC-009 findings)**: a SIMPLE charge
 * into GoService's own provider account. There is NO split/`marketplace_fee`
 * parameter and NO provider-side hold/capture mode here — paying the
 * Professional is a separate concern (GOS-82/GOS-139), and the 7-day
 * retention is a purely internal ledger concept, never something the provider
 * does for us.
 *
 * The card NEVER reaches GoService's servers: `cardToken` is a single-use
 * token the client obtained by tokenizing the card directly with the provider
 * (PCI scope stays SAQ-A). It must never be logged or persisted.
 */

/** A small, stable DOMAIN vocabulary — never the processor's raw detail. */
export type CardRejectionReason =
  | 'CARD_DECLINED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_CARD_DATA'
  | 'PROVIDER_ERROR'
  | 'OTHER';

export interface ChargeCardCommand {
  /** Single-use token from the client-side tokenization. Never logged. */
  cardToken: string;
  /** Major-unit integer amount (same convention as `LedgerEntry.amount`). */
  amount: number;
  /** ISO 4217 code, e.g. `COP` / `ARS`. */
  currency: string;
  /**
   * The Customer's own country (`CustomerProfile.country`) — selects WHICH
   * country's Mercado Pago credentials this charge is made with (2026-09-18:
   * one Mercado Pago account belongs to exactly one country's marketplace).
   */
  country: CountryCode;
  description: string;
  /** `Engagement.id` — lets an asynchronous notification be correlated back. */
  externalReference: string;
  // The three fields below are NOT in the original ticket's command shape:
  // the Orders API REQUIRES them (verified live 2026-09-18 — a request
  // without `payment_method.id` or `payer` is answered 400 `required_properties`).
  /** The card brand id the client's tokenization reported, e.g. `visa`, `master`. */
  paymentMethodId: string;
  installments: number;
  payerEmail: string;
  /**
   * Makes a retry of THIS logical charge safe: the provider returns the same
   * order for the same key instead of charging twice (verified live
   * 2026-09-18). `PaymentAttempt.id`.
   */
  idempotencyKey: string;
}

export interface ChargeCardResult {
  /** The provider's id for the charge (Mercado Pago: the ORDER id). */
  providerPaymentId: string;
  status: 'approved' | 'rejected' | 'pending';
  rejectionReason?: CardRejectionReason;
}

/** What `getPayment` returns: the charge result plus what's needed to correlate/verify it. */
export interface ProviderPaymentSnapshot extends ChargeCardResult {
  /** Echo of the `externalReference` sent at creation (`Engagement.id`). */
  externalReference: string | null;
  /** Major-unit amount the provider reports for the whole charge. */
  amount: number | null;
  currency: string | null;
}

/**
 * Non-sensitive facts about HOW a payment was made, read from the provider's
 * own record once it is approved — what GoService keeps for follow-up and to
 * show the Customer "Visa •••• 6260". Never the card number, CVV, token,
 * cardholder or payer personal data. Every field is nullable: a provider may
 * not report it, and a wallet payment made with balance has no card.
 */
export interface ProviderTransactionDetails {
  /** e.g. `credit_card`, `debit_card`, `account_money`. */
  paymentTypeId: string | null;
  cardBrand: string | null;
  /** Exactly 4 digits, or null. */
  cardLastFour: string | null;
  /** What the provider charged GoService (major units, rounded). Informational. */
  providerFeeAmount: number | null;
  providerTaxAmount: number | null;
  /** What GoService actually receives after fee and tax withholdings. */
  netReceivedAmount: number | null;
  approvedAt: Date | null;
  moneyReleaseAt: Date | null;
}

/**
 * The provider answered definitively that this request creates NO charge
 * (e.g. a malformed/unprocessable request). The attempt is REJECTED.
 */
export class PaymentRequestRejectedError extends Error {
  constructor(readonly rejectionReason: CardRejectionReason) {
    super(`Payment request rejected by provider (${rejectionReason}).`);
    this.name = 'PaymentRequestRejectedError';
  }
}

/**
 * The outcome is UNKNOWN (timeout, network error, provider 5xx): a charge may
 * or may not exist. The attempt must stay PENDING — never assumed rejected —
 * so a later notification can still resolve it.
 */
export class PaymentProviderUnavailableError extends Error {
  constructor(detail: string) {
    super(`Payment provider unavailable: ${detail}`);
    this.name = 'PaymentProviderUnavailableError';
  }
}

/**
 * Credentials/environment are missing or invalid — nothing was sent to the
 * provider. Fail-closed, same philosophy as `ledgerCommissionMisconfigured`.
 */
export class PaymentProviderNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Payment provider not configured: ${detail}`);
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

export abstract class PaymentProviderPort {
  /**
   * @throws PaymentRequestRejectedError — definitive "no charge was created".
   * @throws PaymentProviderUnavailableError — unknown outcome.
   * @throws PaymentProviderNotConfiguredError — nothing was sent.
   * A DECLINED card is NOT an exception: it resolves with `status: 'rejected'`.
   */
  abstract chargeCard(command: ChargeCardCommand): Promise<ChargeCardResult>;

  /**
   * Re-reads the provider's own current state for a charge — used by the
   * asynchronous-notification handler so it never trusts a notification
   * body's claimed status. Resolves `null` when the provider does not know
   * this id (or it is not a well-formed id at all). Same throws as
   * `chargeCard`, minus `PaymentRequestRejectedError`. `country` — see
   * `ChargeCardCommand.country`'s own comment; the caller always derives it
   * from an authoritative source (the webhook route, or the Engagement's own
   * `CustomerProfile.country`), never from the untrusted notification body.
   */
  abstract getPayment(
    providerPaymentId: string,
    country: CountryCode,
  ): Promise<ProviderPaymentSnapshot | null>;

  /**
   * BEST-EFFORT read of the non-sensitive facts of an APPROVED payment (brand,
   * last four, the provider's fee/taxes/net, dates). Resolves `null` when the
   * provider has no record for it yet (its payment record can lag the order by
   * a moment). The caller must treat any failure as "unknown" and NEVER fail or
   * delay the payment because of it. `externalReference` is the reference sent
   * at creation (`Engagement.id`); the record is linked to the order by its
   * EXACT id, never guessed by amount or date. `country` — see `getPayment`'s
   * own comment.
   */
  abstract getTransactionDetails(
    providerPaymentId: string,
    externalReference: string,
    country: CountryCode,
  ): Promise<ProviderTransactionDetails | null>;
}
