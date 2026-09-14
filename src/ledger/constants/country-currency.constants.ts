import { CountryCode } from '@prisma/client';

/**
 * GOS-109 — the `CountryCode -> currency` mapping a `LedgerEntry` is
 * derived from at write time (via the writing party's `CustomerProfile.country`
 * — see `RecordCustomerCancellationChargeService`/
 * `RecordProfessionalCancellationRefundService`). Not invented from nothing:
 * `ServiceRequest.indicativeBudgetMin`'s own schema comment already assumes
 * this exact `AR -> ARS` / `CO -> COP` mapping ("currency is implied by
 * CustomerProfile.country") — this is the first place it becomes real,
 * referenced code, rather than an assumption living only in a comment.
 *
 * **Flagged as a proposal, not a confirmed decision** — no ADR/DEC formally
 * owns this mapping. Revisit if multi-currency/FX ever becomes a real
 * product concern (e.g. a Professional and Customer in different
 * countries, or a currency that isn't 1:1 with `CountryCode`).
 */
export const CURRENCY_BY_COUNTRY: Record<CountryCode, string> = {
  [CountryCode.AR]: 'ARS',
  [CountryCode.CO]: 'COP',
};
