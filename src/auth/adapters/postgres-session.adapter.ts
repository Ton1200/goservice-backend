import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session, SessionStatus } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { SessionPort } from '../ports/session.port';
import { SessionsRepository } from '../sessions.repository';
import {
  generateSessionToken,
  hashSessionToken,
} from '../services/session-token.util';

const HOUR_IN_MS = 60 * 60 * 1000;

/**
 * Default `SessionPort` implementation (GOS-7): an opaque bearer token
 * (`generateSessionToken`), SHA-256-hashed before it ever reaches
 * `SessionsRepository`/Postgres. Expiry is evaluated lazily at read time —
 * an ACTIVE-but-past-`expiresAt` row is flipped to `EXPIRED` the moment it
 * is looked up or targeted for revocation, rather than via a background
 * job (none exists in this codebase, and none is introduced here).
 */
@Injectable()
export class PostgresSessionAdapter implements SessionPort {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async createSession(input: {
    userId: string;
  }): Promise<{ sessionToken: string; expiresAt: Date }> {
    const { ttlHours } = this.configService.get('session', { infer: true });
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + ttlHours * HOUR_IN_MS);

    await this.sessionsRepository.create({
      userId: input.userId,
      tokenHash,
      expiresAt,
    });

    // The plaintext token is returned exactly once, here — it is never
    // persisted, logged, or reconstructable from `tokenHash`.
    return { sessionToken, expiresAt };
  }

  async findActiveSessionUserId(sessionToken: string): Promise<string | null> {
    const session = await this.loadEffectiveSession(sessionToken);
    if (!session || session.status !== SessionStatus.ACTIVE) {
      return null;
    }
    return session.userId;
  }

  async revokeSession(sessionToken: string): Promise<boolean> {
    const session = await this.loadEffectiveSession(sessionToken);
    if (!session || session.status !== SessionStatus.ACTIVE) {
      // Idempotent: unknown, already-revoked, and (lazily-flipped) expired
      // sessions all resolve to `false` here.
      return false;
    }
    await this.sessionsRepository.markRevoked(session.id);
    return true;
  }

  /**
   * Revokes every `ACTIVE` session for `userId` in bulk — see
   * `SessionPort.revokeAllSessionsForUser`'s doc comment. Unlike
   * `revokeSession`, there is no per-row expiry check here: an
   * already-lazily-expired row is `EXPIRED`, not `ACTIVE`, so
   * `SessionsRepository.revokeAllActiveForUser`'s `WHERE status = ACTIVE`
   * clause naturally excludes it without needing to load/flip each row
   * first.
   */
  async revokeAllSessionsForUser(userId: string): Promise<number> {
    return this.sessionsRepository.revokeAllActiveForUser(userId);
  }

  /**
   * Looks up the session by token and lazily flips an ACTIVE-but-expired
   * row to `EXPIRED` before returning it.
   */
  private async loadEffectiveSession(
    sessionToken: string,
  ): Promise<Session | null> {
    const tokenHash = hashSessionToken(sessionToken);
    const session = await this.sessionsRepository.findByTokenHash(tokenHash);
    if (!session) {
      return null;
    }
    if (
      session.status === SessionStatus.ACTIVE &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      return this.sessionsRepository.markExpired(session.id);
    }
    return session;
  }
}
