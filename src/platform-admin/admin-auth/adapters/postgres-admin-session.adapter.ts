import { Injectable } from '@nestjs/common';
import { AdminSession, AdminSessionStatus } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-settings/ports/platform-setting.port';
import { AdminSessionPort } from '../ports/admin-session.port';
import { AdminSessionsRepository } from '../admin-sessions.repository';
import {
  generateAdminSessionToken,
  hashAdminSessionToken,
} from '../services/admin-session-token.util';

const MINUTE_IN_MS = 60 * 1000;

// Admin-configurable (2026-08-11 follow-up — was ADMIN_SESSION_TTL_MINUTES,
// a boot-time env var, REMOVED not deprecated; see
// `env-validation.schema.ts`'s own comment). Editable from the panel
// itself, under a new "Admin" > "Session" group — see
// `admin-panel/js/settings.js`'s `KNOWN_SETTING_SLOTS` and
// `prisma/seed.ts`'s seeded default (both `'30'`, matching this file's own
// fallback below).
const ADMIN_SESSION_TIMEOUT_SETTING_KEY = 'admin.session.timeout-minutes';
const DEFAULT_TTL_MINUTES = 30;

/**
 * Default `AdminSessionPort` implementation — the platform-admin parallel
 * of `src/auth/adapters/postgres-session.adapter.ts`, written from scratch
 * (zero shared code, per the plan's isolation requirement). Same
 * lazy-expiry-at-read-time behavior, but a much shorter, minutes-scale TTL
 * than the consumer session's `ttlHours`.
 */
@Injectable()
export class PostgresAdminSessionAdapter implements AdminSessionPort {
  constructor(
    private readonly adminSessionsRepository: AdminSessionsRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  /**
   * Reads the current TTL fresh on every session creation (never cached) —
   * an admin changing this setting takes effect for the very next login,
   * with zero redeploy. Defensive fallback to `DEFAULT_TTL_MINUTES` if the
   * setting is missing (unseeded environment), non-numeric, or not a
   * positive integer — a malformed/missing session-timeout setting must
   * never crash login or produce a nonsensical (zero, negative, NaN)
   * `expiresAt`.
   */
  private async resolveTtlMinutes(): Promise<number> {
    const raw = await this.platformSettingPort.getValue(
      ADMIN_SESSION_TIMEOUT_SETTING_KEY,
    );
    const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_TTL_MINUTES;
  }

  async createSession(input: {
    adminUserId: string;
  }): Promise<{ sessionToken: string; expiresAt: Date }> {
    const ttlMinutes = await this.resolveTtlMinutes();
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
