/**
 * Thrown by `AesGcmCredentialEncryptionAdapter` when
 * `ADMIN_CREDENTIALS_ENCRYPTION_KEY` is missing or malformed at the point a
 * credential is actually encrypted/decrypted (never at plain app startup —
 * see `env-validation.schema.ts`'s comment on that env var). A genuine
 * server-misconfiguration error, not a `DomainException` (there is no safe,
 * user-facing GraphQL message here beyond "something is misconfigured";
 * this should surface as a generic 500 to the admin panel and a clear,
 * actionable message in server logs/stderr for whoever operates this
 * deployment).
 *
 * The message below is deliberately generic and instructive — it NEVER
 * includes the actual (invalid) env var value, even in a malformed/garbled
 * form, per this codebase's absolute rule against ever logging credential
 * material.
 */
export class InvalidCredentialEncryptionKeyError extends Error {
  constructor() {
    super(
      'ADMIN_CREDENTIALS_ENCRYPTION_KEY is missing or malformed. It must be ' +
        'set to a base64-encoded 256-bit (32-byte) key. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
    this.name = 'InvalidCredentialEncryptionKeyError';
  }
}
