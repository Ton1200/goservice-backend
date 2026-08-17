import { DomainException } from '../../common/errors/domain-exception';

const IDENTITY_VERIFICATION_PROVIDER_ERROR_CODE =
  'IDENTITY_VERIFICATION_PROVIDER_ERROR';

/**
 * Thrown by `DiditIdentityVerificationAdapter.createSession()` when Didit's
 * API itself is reachable and this app's own configuration is valid
 * (`api-key`/`workflow-id` are both present — otherwise
 * `IDENTITY_VERIFICATION_MISCONFIGURED` fires instead), but the actual HTTP
 * call to `POST /v3/session/` fails — a non-2xx response, a network error,
 * or an unparsable response body. NOT one of the plan's originally
 * enumerated codes (`IDENTITY_VERIFICATION_DISABLED`/
 * `_COUNTRY_NOT_SUPPORTED`/`_MISCONFIGURED`) — added because the plan's own
 * Definition of Done requires "ninguno cae en 500 genérico" for every
 * failure mode, and a transient Didit-side outage/error is a real, distinct
 * failure mode neither of those three codes describes (it is not "we turned
 * it off", not "this country isn't routed", and not "nobody configured a
 * credential" — Didit itself rejected or failed the call). Never includes
 * the raw response body/error detail in `message` (could leak
 * provider-internal details) — only a safe, generic message; the real
 * detail is logged server-side only (see the adapter's own logging).
 */
export function identityVerificationProviderError(): DomainException {
  return new DomainException(
    IDENTITY_VERIFICATION_PROVIDER_ERROR_CODE,
    'Identity verification could not be started right now. Please try again shortly.',
  );
}
