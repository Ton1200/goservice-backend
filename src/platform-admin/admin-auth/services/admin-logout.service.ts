import { Injectable, Logger } from '@nestjs/common';
import { AdminSessionPort } from '../ports/admin-session.port';

/**
 * The admin parallel of `src/auth/services/logout.service.ts`. Deliberately
 * never throws — a missing/unknown/already-revoked/already-expired token
 * all resolve to `false` (idempotent no-op); a real, active session being
 * revoked resolves to `true`. Never logs the session token itself.
 */
@Injectable()
export class AdminLogoutService {
  private readonly logger = new Logger(AdminLogoutService.name);

  constructor(private readonly adminSessionPort: AdminSessionPort) {}

  async adminLogout(sessionToken: string | null): Promise<boolean> {
    if (!sessionToken) {
      this.logger.log({ event: 'admin_logout_attempt', outcome: 'noop' });
      return false;
    }

    const revoked = await this.adminSessionPort.revokeSession(sessionToken);
    this.logger.log({
      event: 'admin_logout_attempt',
      outcome: revoked ? 'revoked' : 'noop',
    });
    return revoked;
  }
}
