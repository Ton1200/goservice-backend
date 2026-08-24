import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { EngagementChatModuleEnabledGuard } from './guards/engagement-chat-module-enabled.guard';
import { EngagementChatResolver } from './engagement-chat.resolver';

/**
 * Wiring-only test — same reasoning as
 * `admin-quote-negotiation.resolver.spec.ts`: the actual BEHAVIOR of each
 * guard is already fully unit-tested in its own spec file
 * (`session.guard.spec.ts`, `account-approved.guard.spec.ts`,
 * `engagement-chat-module-enabled.guard.spec.ts`). What's not covered
 * anywhere else is which guards, and in which order, THIS resolver actually
 * declares — in particular, that `EngagementChatModuleEnabledGuard` was
 * added (follow-up round) and applies uniformly to BOTH
 * `sendEngagementMessage`/`engagementMessages`, since it's declared once at
 * the resolver-class level, not per-method.
 */
describe('EngagementChatResolver wiring', () => {
  it('applies SessionGuard, then AccountApprovedGuard, then EngagementChatModuleEnabledGuard, in that exact order', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      EngagementChatResolver,
    ) as unknown[];

    expect(guards).toEqual([
      SessionGuard,
      AccountApprovedGuard,
      EngagementChatModuleEnabledGuard,
    ]);
  });
});
