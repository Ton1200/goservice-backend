import type { ProviderPaymentSnapshot } from '../ports/payment-provider.port';

/**
 * GOS-146 — the ONE amount/currency safety check every path makes before it
 * ever approves money (the Mercado Pago webhook, the Rapyd webhook, and the
 * read-time reconciliation). Extracted from the two identical inline copies
 * `HandleMercadoPagoNotificationService` and
 * `GetMyEngagementPaymentAttemptService` used to carry, so a third provider
 * cannot drift from them.
 */

/**
 * Provider amounts are integers in MAJOR units (`LedgerEntry.amount`'s
 * convention). A provider that reports decimals (ARS: `50000.00`, or a
 * fractional amount) is rounded to the nearest whole unit — the same rounding
 * `mercadopago-payment-record.mapper.ts` applies to fees and taxes. `null`
 * for anything that is not a finite number.
 */
export function roundToMajorUnits(value: unknown): number | null {
  const parsed =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.round(parsed)
    : null;
}

/**
 * `true` unless the snapshot claims `approved` for an amount or currency that
 * does NOT equal what the attempt froze at creation. Only `approved` is
 * checked: a `rejected`/`pending` snapshot moves no money, so a mismatch there
 * is harmless. Never approve money that does not reconcile.
 */
export function isSnapshotConsistentWithAttempt(
  snapshot: Pick<ProviderPaymentSnapshot, 'status' | 'amount' | 'currency'>,
  attempt: { amount: number; currency: string },
): boolean {
  if (snapshot.status !== 'approved') {
    return true;
  }
  return (
    snapshot.amount === attempt.amount &&
    snapshot.currency?.toUpperCase() === attempt.currency.toUpperCase()
  );
}
