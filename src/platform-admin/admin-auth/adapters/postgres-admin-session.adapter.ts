import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminSession, AdminSessionStatus } from '@prisma/client';
import type { AppConfig } from '../../../config/configuration';
import { AdminSessionPort } from '../ports/admin-session.port';
import { AdminSessionsRepository } from '../admin-sessions.repository';
import {
  generateAdminSessionToken,
  hashAdminSessionToken,
} from '../services/admin-session-token.util';

const MINUTE_IN_MS = 60 * 1000;

/**
 * Default `AdminSessionPort` implementation — the platform-admin parallel
 * of `src/auth/adapters/postgres-session.adapter.ts`, written from scratch
 * (zero shared code, per the plan's isolation requirement). Same
 * lazy-expiry-at-read-time behavior, but a much shorter, minutes-scale TTL
 * (`adminSession.ttlMinutes`, not `session.ttlHours`) — see
 * `src/config/configuration.ts`.
 */
@Injectable()
export class PostgresAdminSessionAdapter implements AdminSessionPort {
  constructor(
    private readonly adminSessionsRepository: AdminSessionsRepository,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async createSession(input: {
    adminUserId: string;
  }): Promise<{ sessionToken: string; expiresAt: Date }> {
    const { ttlMinutes } = this.configService.get('adminSession', {
      infer: true,
    });
    const sessionToken = generateAdminSessionToken();
    const tokenHash = hashAdminSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + ttlMinutes * MINUTE_IN_MS);

    await this.adminSessionsRepository.create({
      adminUserId: input.adminUserId,
      tokenHash,
      expiresAt,
    });

    // Returned exactly once, here — never persisted, logged, or
    // reconstructable from `tokenHash`.
    return { sessionToken, expiresAt };
  }

  async findActiveSessionAdminUserId(
    sessionToken: string,
  ): Promise<string | null> {
    const session = await this.loadEffectiveSession(sessionToken);
    if (!session || session.status !== AdminSessionStatus.ACTIVE) {
      return null;
    }
    return session.adminUserId;
  }

  async revokeSession(sessionToken: string): Promise<boolean> {
    const session = await this.loadEffectiveSession(sessionToken);
    if (!session || session.status !== AdminSessionStatus.ACTIVE) {
      return false;
    }
    await this.adminSessionsRepository.markRevoked(session.id);
    return true;
  }

  private async loadEffectiveSession(
    sessionToken: string,
  ): Promise<AdminSession | null> {
    const tokenHash = hashAdminSessionToken(sessionToken);
    const session =
      await this.adminSessionsRepository.findByTokenHash(tokenHash);
    if (!session) {
      return null;
    }
    if (
      session.status === AdminSessionStatus.ACTIVE &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      return this.adminSessionsRepository.markExpired(session.id);
    }
    return session;
  }
}
