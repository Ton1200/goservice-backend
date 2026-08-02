/**
 * Abstraction over session issuance/lookup/revocation, so `LoginService`/
 * `SocialLoginService`/`LogoutService` don't depend directly on Prisma or
 * any particular session mechanism — see
 * `adapters/postgres-session.adapter.ts` for the only implementation
 * (opaque token, SHA-256-hashed at rest, no JWT/Redis/cookies). The final
 * session mechanism remains TBD at the architecture level (see the GOS-7
 * plan's "Decisiones pendientes") — this port exists so that choice can
 * change later without touching any application service.
 */
export abstract class SessionPort {
  abstract createSession(input: {
    userId: string;
  }): Promise<{ sessionToken: string; expiresAt: Date }>;

  /** Returns the owning `userId`, or `null` if the token is unknown, not ACTIVE, or expired. */
  abstract findActiveSessionUserId(
    sessionToken: string,
  ): Promise<string | null>;

  /** Idempotent: `true` only when an ACTIVE, unexpired session was revoked; `false` for unknown/already-revoked/expired. */
  abstract revokeSession(sessionToken: string): Promise<boolean>;
}
