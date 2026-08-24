import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_CHAT_MODULE_DISABLED_CODE = 'ENGAGEMENT_CHAT_MODULE_DISABLED';

/**
 * Thrown by `EngagementChatModuleEnabledGuard` when the
 * `customer.chat.enabled` `PlatformSetting` currently resolves to
 * `false` — the GLOBAL kill switch for this whole capability (both
 * `sendEngagementMessage` and `engagementMessages`). Applied to every
 * resolver method in `EngagementChatResolver`, same "one guard, every
 * operation" convention as `QuoteNegotiationModuleEnabledGuard` (see that
 * guard's own header comment, `src/quote-negotiation/guards/
 * quote-negotiation-module-enabled.guard.ts`, for the precedent this
 * mirrors).
 */
export function engagementChatModuleDisabled(): DomainException {
  return new DomainException(
    ENGAGEMENT_CHAT_MODULE_DISABLED_CODE,
    'Engagement Chat is currently disabled.',
  );
}
