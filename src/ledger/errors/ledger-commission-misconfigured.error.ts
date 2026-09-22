import { DomainException } from '../../common/errors/domain-exception';

const LEDGER_COMMISSION_MISCONFIGURED_CODE = 'LEDGER_COMMISSION_MISCONFIGURED';

/**
 * Thrown by `RecordCustomerCancellationChargeService` when
 * `PlatformSettingPort.getValue('payments.general-settings.commission.percent')`
 * returns `null` (unseeded/typo'd key) or parses to `NaN` (a non-numeric value
 * somehow stored under that key) — checked BEFORE any calculation or
 * `LedgerEntry` write is attempted. Mirrors `socialLoginMisconfigured()`
 * (`src/auth/errors/social-login-misconfigured.error.ts`) exactly: a
 * server-misconfiguration condition, fail-closed per this codebase's own
 * philosophy (real backend enforcement, clear errors, no silent
 * guessing/defaulting) rather than falling back to some hardcoded
 * percentage.
 *
 * GOS-85: `RecordDigitalPaymentService` (card payments) raises the SAME code
 * — same misconfiguration, same fix — with its own `message`, so the text
 * doesn't wrongly say "cancellation" for a payment.
 */
export function ledgerCommissionMisconfigured(
  message = "GoService's commission percentage is not configured yet — this cancellation cannot be charged.",
): DomainException {
  return new DomainException(LEDGER_COMMISSION_MISCONFIGURED_CODE, message);
}
