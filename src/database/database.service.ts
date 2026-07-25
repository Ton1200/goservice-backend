import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { AppConfig } from '../config/configuration';

/**
 * Thin wrapper around a `pg` connection pool.
 *
 * Pilot-only persistence decision: plain `pg` driver, no ORM (see
 * database.module.ts for the rationale/pointer to the still-open ADR
 * question). This service intentionally does nothing beyond proving
 * connectivity — no query methods for domain data belong here.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    const dbConfig = this.configService.get('database', { infer: true });

    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.name,
      user: dbConfig.user,
      password: dbConfig.password,
      max: dbConfig.poolMax,
    });

    // Idle-client errors surface here instead of crashing the process.
    // Log only a stable error code/name — never the driver's raw message,
    // which can otherwise echo back host/user/connection details.
    this.pool.on('error', (error: NodeJS.ErrnoException) => {
      this.logger.error(
        `Unexpected PostgreSQL pool error (${this.safeErrorCode(error)})`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('PostgreSQL pool closed cleanly on module destroy.');
  }

  /**
   * Executes `SELECT 1` against the live database. Returns true only if the
   * query actually round-trips successfully. Never throws — callers only
   * need a boolean, and no raw driver error (which could include host,
   * port, or auth-failure detail) is ever propagated to the caller or
   * logged in full.
   */
  async checkConnection(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ '?column?': number }>('SELECT 1');
      return result.rowCount === 1;
    } catch (error) {
      this.logger.error(
        `Database health check failed (${this.safeErrorCode(error)})`,
      );
      return false;
    }
  }

  /**
   * Reduces any error to a short, non-sensitive identifier suitable for
   * logs (e.g. pg error codes like `28P01` for auth failure, or Node
   * network error codes like `ECONNREFUSED`) — never the full error
   * message, which some drivers/OS layers can pad with host/user detail.
   */
  private safeErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) {
        return code;
      }
    }
    return 'UNKNOWN_ERROR';
  }
}
