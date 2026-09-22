/**
 * GOS-109 — the ONE commission-split rule this whole ledger reuses, per
 * DEC-008 point 5 ("the cancellation fee is treated as a small 'job' of its
 * own for commission purposes, reusing `computeCommission` rather than a
 * separate rule"). A plain, framework-independent pure function — NOT
 * `@Injectable()` — testable with zero NestJS/Prisma machinery, per this
 * codebase's "business rules should be testable without spinning up the
 * full module graph" standard.
 *
 * **Rounding rule, load-bearing for the ledger's zero-sum invariant**:
 * `commission = Math.round(amount * commissionPercent / 100)`, and
 * `net = amount - commission` — `net` is always a REMAINDER, never
 * independently rounded. This guarantees `commission + net === amount`
 * EXACTLY, for every integer `amount`/`commissionPercent`, even when
 * `amount * commissionPercent` doesn't divide evenly by 100. Combined with
 * `RecordCustomerCancellationChargeService`'s own negative
 * `CUSTOMER_CANCELLATION_FEE` entry (`-amount`), this is what makes
 * `-amount + commission + net === 0` hold for every cancellation-charge
 * event this ledger ever writes, regardless of rounding.
 */
export interface CommissionSplit {
  commission: number;
  net: number;
}

export function computeCommission(
  amount: number,
  commissionPercent: number,
): CommissionSplit {
  const commission = Math.round((amount * commissionPercent) / 100);
  const net = amount - commission;
  return { commission, net };
}
