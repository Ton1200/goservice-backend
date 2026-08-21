import { IdentityVerificationStatus } from '@prisma/client';

/**
 * Pure domain function (no NestJS DI, no I/O — trivially unit-testable
 * without spinning up the module graph, per this codebase's
 * framework-independence-where-practical preference): derives the
 * `IdentityVerificationStatus` from the two boolean checks a verification
 * attempt can pass/fail. `null` means "that check hasn't run/reported yet"
 * — the ONLY way to get anything other than `PENDING` back is for BOTH
 * checks to have reported (no partial-approval path exists — a professional
 * or customer is never approved on document-only or biometric-only
 * success).
 *
 * Shared by TWO callers, deliberately: `DiditIdentityVerificationAdapter.
 * translateWebhookPayload()` (to fill `IdentityVerificationResult.status`)
 * and `HandleIdentityVerificationWebhookService` (to decide the
 * `IdentityVerification` row's own persisted `status`, and in turn whether
 * `User.accountStatus` transitions) — both must always agree, so the
 * decision logic lives in exactly one place.
 */
export function resolveIdentityVerificationStatus(
  documentCheckPassed: boolean | null,
  biometricCheckPassed: boolean | null,
): IdentityVerificationStatus {
  if (documentCheckPassed === null || biometricCheckPassed === null) {
    return IdentityVerificationStatus.PENDING;
  }
  return documentCheckPassed && biometricCheckPassed
    ? IdentityVerificationStatus.APPROVED
    : IdentityVerificationStatus.REJECTED;
}
