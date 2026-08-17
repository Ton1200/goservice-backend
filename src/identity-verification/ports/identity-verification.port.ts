import { CountryCode, IdentityDocumentType } from '@prisma/client';

/**
 * Command to start one hosted verification session — `identityVerificationId`
 * is OUR OWN `IdentityVerification.id` (generated app-side before the row is
 * persisted — see `StartIdentityVerificationService`), sent to the provider
 * as its own opaque correlation identifier (Didit's `vendor_data`). `country`
 * is always resolved server-side from the caller's own profile — see
 * `IdentityVerificationProviderRegistry`/`StartIdentityVerificationService` —
 * never a client-supplied value.
 */
export interface CreateIdentityVerificationSessionCommand {
  identityVerificationId: string;
  country: CountryCode;
}

/** What a successfully created hosted session gives back. */
export interface IdentityVerificationSession {
  /** The provider's own session identifier — persisted as
   * `IdentityVerification.providerReference`. */
  providerReference: string;
  /** The hosted URL the client opens (WebView/browser) to complete document
   * + selfie/liveness capture — GoService's backend never receives or
   * stores that captured media itself. */
  verificationUrl: string;
}

/**
 * The domain-level, provider-agnostic outcome of one webhook payload —
 * `DiditIdentityVerificationAdapter.translateWebhookPayload()` is the ONLY
 * place a raw Didit JSON shape is ever read; everything downstream
 * (`HandleIdentityVerificationWebhookService`) only ever sees this shape.
 *
 * `documentCheckPassed`/`biometricCheckPassed` are `null` exactly when the
 * provider payload carries no `decision` object yet (e.g. an early
 * `status.updated` event for `Not Started`/`In Progress` — no checks have
 * run yet); once a `decision` object IS present, both are always resolved
 * to a real `boolean` (never left `null`) — see the adapter's own comment
 * for the exact AND-composition formula.
 */
export interface IdentityVerificationResult {
  providerReference: string;
  documentCheckPassed: boolean | null;
  biometricCheckPassed: boolean | null;
  documentType: IdentityDocumentType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * Provider-agnostic seam for identity-verification vendors — same
 * Port/Adapter shape already established twice in this backend
 * (`EmailClientPort`, `SocialIdentityValidationPort`/
 * `SessionPort`). Only one concrete implementation exists today
 * (`DiditIdentityVerificationAdapter`), but the seam is kept (not collapsed
 * to a direct call) so a second provider is a new adapter + one more
 * `IdentityVerificationProviderRegistry` branch, never a domain/resolver
 * rewrite — see that class's own header comment.
 *
 * DEVIATION FROM THE ORIGINAL DESIGN DRAFT, documented here deliberately:
 * `verifyWebhookSignature` returns `Promise<boolean>`, not a synchronous
 * `boolean`. The original draft sketched it as synchronous, but the
 * signature secret (`identity.didit.<mode>.webhook-secret`) must be read
 * LIVE from `PlatformSettingPort` on every call (never cached — the same
 * "resolved live, per-call" discipline every other provider-config read in
 * this codebase already follows, e.g. `ResendEmailClientAdapter.send()`),
 * which is an inherently asynchronous DB read. A synchronous signature
 * would have forced either caching the secret (stale-credential risk if an
 * admin rotates it) or resolving it outside the adapter (breaking "the
 * adapter is 100% responsible for its own signature verification" from
 * this port's own design intent). Widening the return type to a Promise is
 * the smaller, more reversible change.
 */
export abstract class IdentityVerificationPort {
  abstract createSession(
    command: CreateIdentityVerificationSessionCommand,
  ): Promise<IdentityVerificationSession>;

  abstract translateWebhookPayload(
    rawPayload: unknown,
  ): IdentityVerificationResult;

  abstract verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<boolean>;
}
