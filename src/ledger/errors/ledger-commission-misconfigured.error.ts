import { DomainException } from '../../common/errors/domain-exception';

const LEDGER_COMMISSION_MISCONFIGURED_CODE = 'LEDGER_COMMISSION_MISCONFIGURED';

/**
 * Thrown by `RecordCustomerCancellationChargeService` when
 * `PlatformSettingPort.getValue('payments.commission.percent')` returns
 * `null` (unseeded/typo'd key) or parses to `NaN` (a non-numeric value
 * somehow stored under that key) — checked BEFORE any calculation or
 * `LedgerEntry` write is attempted. Mirrors `socialLoginMisconfigured()`
 * (`src/auth/errors/social-login-misconfigured.error.ts`) exactly: a
 * server-misconfiguration condition, fail-closed per this codebase's own
 * philosophy (real backend enforcement, clear errors, no silent
 * guessing/defaulting) rather than falling back to some hardcoded
 * percentage.
 */
export function ledgerCommissionMisconfigured(): DomainException {
  return new DomainException(
    LEDGER_COMMISSION_MISCONFIGURED_CODE,
    "GoService's commission percentage is not configured yet — this cancellation cannot be charged.",
  );
}
