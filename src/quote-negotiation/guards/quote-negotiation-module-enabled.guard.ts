import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { quoteNegotiationModuleDisabled } from '../errors/quote-negotiation-module-disabled.error';

export const QUOTE_NEGOTIATION_GENERAL_ENABLED_KEY =
  'quote-negotiation.general.enabled';

/**
 * The GLOBAL kill switch for the whole Quote Negotiation capability — reads
 * the `quote-negotiation.general.enabled` `PlatformSetting` via
 * `PlatformSettingPort.isEnabled` (a real, admin-toggleable row — see
 * `quote-negotiation.module.ts`'s own header comment for why this is NOT a
 * hardcoded TS constant). Applied via `@UseGuards(SessionGuard,
 * AccountApprovedGuard, QuoteNegotiationModuleEnabledGuard)` on every
 * `QuoteNegotiationResolver` method, in that exact order — must run AFTER
 * `SessionGuard`/`AccountApprovedGuard` for consistency with the rest of
 * this codebase's guard-ordering convention, even though this guard itself
 * doesn't read `req.userId`.
 *
 * Does NOT gate the platform-admin `adminQuoteNegotiationThread` read query
 * — see that resolver's own header comment for the deliberate reasoning
 * (an admin's ability to audit existing negotiation history shouldn't
 * disappear just because the client-facing capability was toggled off).
 */
@Injectable()
export class QuoteNegotiationModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      QUOTE_NEGOTIATION_GENERAL_ENABLED_KEY,
    );
    if (!enabled) {
      throw quoteNegotiationModuleDisabled();
    }
    return true;
  }
}
