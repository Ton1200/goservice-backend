import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { engagementChatModuleDisabled } from '../errors/engagement-chat-module-disabled.error';

// Renamed from `customer.engagement-chat.enabled` (2026-08-21 follow-up,
// human-requested): the admin panel's Settings tree derives its group label
// directly from this key's dot-path segments (see
// `admin-panel/js/settings.js`'s `humanizeSegment`), and "Engagement Chat"
// read as unnecessarily verbose next to the feature's actual name — just
// "Chat". The `EngagementChat*` TS/GraphQL identifiers (module, resolver,
// repository, `EngagementMessage` type, etc.) are UNCHANGED — this rename is
// scoped to the `PlatformSetting` key and its admin-facing Settings group
// label only, not the domain/code naming.
export const ENGAGEMENT_CHAT_ENABLED_KEY = 'customer.chat.enabled';

/**
 * The GLOBAL kill switch for the whole Engagement Chat ("Chat de
 * Coordinación") capability — reads the `customer.chat.enabled`
 * `PlatformSetting` via `PlatformSettingPort.isEnabled` (a real,
 * admin-toggleable row — see `prisma/seed.ts`'s own comment on this key for
 * why it lives under the `customer.*` group). Mirrors
 * `QuoteNegotiationModuleEnabledGuard` exactly (see that guard's own header
 * comment, `src/quote-negotiation/guards/
 * quote-negotiation-module-enabled.guard.ts`) — same mechanism, same
 * guard-ordering convention.
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * EngagementChatModuleEnabledGuard)` on every `EngagementChatResolver`
 * method, in that exact order — must run AFTER `SessionGuard`/
 * `AccountApprovedGuard` for consistency with the rest of this codebase's
 * guard-ordering convention, even though this guard itself doesn't read
 * `req.userId`.
 *
 * Does NOT gate the platform-admin `adminEngagementChatThread` read query —
 * same reasoning `QuoteNegotiationModuleEnabledGuard`'s FIRST round
 * documented (an admin's ability to audit existing coordination-chat
 * history shouldn't disappear just because the client-facing capability was
 * toggled off), applied here per explicit instruction for this feature.
 * (Note: the quote-negotiation sibling's own admin surface later REVERSED
 * that reasoning and gated `adminQuoteNegotiationThread` by its own flag
 * too — a subsequent, explicit human decision specific to that feature. No
 * equivalent reversal was requested for Engagement Chat as of this round;
 * see `AdminEngagementChatResolver`'s own header comment.)
 */
@Injectable()
export class EngagementChatModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      ENGAGEMENT_CHAT_ENABLED_KEY,
    );
    if (!enabled) {
      throw engagementChatModuleDisabled();
    }
    return true;
  }
}
