/**
 * Abstraction over admin-session issuance/lookup/revocation — the
 * platform-admin parallel of `src/auth/ports/session.port.ts`, deliberately
 * NOT extending or importing it (zero shared session/guard code between the
 * consumer and admin mechanisms — see the platform-admin plan). The only
 * implementation is `../adapters/postgres-admin-session.adapter.ts`.
 */
export abstract class AdminSessionPort {
  abstract createSession(input: {
    adminUserId: string;
  }): Promise<{ sessionToken: string; expiresAt: Date }>;

  /** Returns the owning `adminUserId`, or `null` if the token is unknown, not ACTIVE, or expired. */
  abstract findActiveSessionAdminUserId(
    sessionToken: string,
  ): Promise<string | null>;

  /** Idempotent: `true` only when an ACTIVE, unexpired session was revoked; `false` for unknown/already-revoked/expired. */
  abstract revokeSession(sessionToken: string): Promise<boolean>;
}
