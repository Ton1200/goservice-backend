import { Injectable, Logger } from '@nestjs/common';
import { SessionPort } from '../ports/session.port';

/**
 * Orchestrates `logout` (GOS-7). Deliberately never throws a
 * `DomainException` — a missing token (`null`, e.g. no `Authorization`
 * header sent), an unknown token, or an already-revoked/already-expired
 * token all resolve to `false` (idempotent no-op); a real, active session
 * being revoked resolves to `true`. Never logs the session token itself.
 */
@Injectable()
export class LogoutService {
  private readonly logger = new Logger(LogoutService.name);

  constructor(private readonly sessionPort: SessionPort) {}

  async logout(sessionToken: string | null): Promise<boolean> {
    if (!sessionToken) {
      this.logger.log({ event: 'logout_attempt', outcome: 'noop' });
      return false;
    }

    const revoked = await this.sessionPort.revokeSession(sessionToken);
    this.logger.log({
      event: 'logout_attempt',
      outcome: revoked ? 'revoked' : 'noop',
    });
    return revoked;
  }
}
