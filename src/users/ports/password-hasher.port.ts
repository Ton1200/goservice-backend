/**
 * Abstraction over password hashing/verification, so
 * `RegisterUserService` doesn't depend directly on `argon2` (or any other
 * concrete library) — see `adapters/argon2-password-hasher.adapter.ts` for
 * the only implementation.
 */
export abstract class PasswordHasherPort {
  abstract hash(plainTextPassword: string): Promise<string>;
  abstract verify(hash: string, plainTextPassword: string): Promise<boolean>;
}
