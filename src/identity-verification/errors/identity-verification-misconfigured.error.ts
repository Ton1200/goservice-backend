import { DomainException } from '../../common/errors/domain-exception';

const IDENTITY_VERIFICATION_MISCONFIGURED_CODE =
  'IDENTITY_VERIFICATION_MISCONFIGURED';

/**
 * Thrown by `DiditIdentityVerificationAdapter.createSession()` when
 * `identity.didit.enabled` is on (already passed
 * `IdentityVerificationProviderRegistry.resolve()`) but the currently
 * active mode's (`identity.didit.mode` — SANDBOX or PRODUCTION) own
 * `api-key`/`workflow-id` has never been configured in the admin panel —
 * mirrors `socialLoginMisconfigured()`'s/`emailDeliveryMisconfigured()`'s
 * exact pattern: a server-misconfiguration condition, safe to disclose
 * distinctly (never a credential-guessing signal), fail-closed per this
 * codebase's philosophy of never silently proceeding with a missing
 * credential.
 */
export function identityVerificationMisconfigured(): DomainException {
  return new DomainException(
    IDENTITY_VERIFICATION_MISCONFIGURED_CODE,
    'Identity verification is not fully configured yet.',
  );
}
