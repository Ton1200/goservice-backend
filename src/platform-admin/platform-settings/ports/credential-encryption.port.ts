/**
 * Symmetric encryption boundary for `PlatformCredential.ciphertext` — the
 * ONLY abstraction any application code should depend on to turn a
 * credential's real value into (and back out of) its at-rest encrypted
 * form. `AesGcmCredentialEncryptionAdapter`
 * (`../adapters/aes-gcm-credential-encryption.adapter.ts`) is the only
 * implementation today.
 *
 * `decrypt()` is the ONE legitimate place plaintext credential material
 * exists in memory outside a fresh `setPlatformCredential` mutation's own
 * input — its only caller is
 * `../adapters/prisma-platform-credential.adapter.ts` (the
 * `PlatformCredentialPort` implementation), never a resolver, never logged.
 *
 * Fields are typed as the plain `Uint8Array` (not `Buffer`) deliberately:
 * Prisma's generated `Bytes`-column types are `Uint8Array<ArrayBuffer>`
 * (Prisma 6 + modern `@types/node`), a narrower shape than `Buffer`'s own
 * `Buffer<ArrayBufferLike>` generic — using the plain, broader `Uint8Array`
 * here lets a Prisma row's `ciphertext`/`iv`/`authTag` flow straight in
 * without a manual conversion, while `AesGcmCredentialEncryptionAdapter`
 * still freely uses real `Buffer` instances internally (a `Buffer` IS a
 * `Uint8Array` structurally, so it satisfies this interface as-is).
 */
export interface EncryptedCredential {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export abstract class CredentialEncryptionPort {
  abstract encrypt(plaintext: string): EncryptedCredential;
  abstract decrypt(encrypted: EncryptedCredential): string;
  /**
   * A short, non-reversible confirmation string safe to expose over
   * GraphQL (e.g. "termina en •••1234") — computed at write time, never
   * derived from the ciphertext later. See the concrete adapter for the
   * exact format, including the short-value fallback.
   */
  abstract maskedPreview(plaintext: string): string;
}
