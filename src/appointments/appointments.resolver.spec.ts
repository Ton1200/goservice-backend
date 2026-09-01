import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { AppointmentsModuleEnabledGuard } from './guards/appointments-module-enabled.guard';
import { AppointmentsResolver } from './appointments.resolver';

/**
 * Wiring-only test — same reasoning as `EngagementChatResolver`'s own
 * `engagement-chat.resolver.spec.ts`: the actual BEHAVIOR of each guard is
 * already fully unit-tested in its own spec file. What's not covered
 * anywhere else is which guards, and in which order, THIS resolver actually
 * declares — now a third guard, `AppointmentsModuleEnabledGuard` (follow-up
 * round), mirroring `EngagementChatResolver`'s own 3-guard chain.
 */
describe('AppointmentsResolver wiring', () => {
  it('applies SessionGuard, AccountApprovedGuard, then AppointmentsModuleEnabledGuard, in that exact order', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AppointmentsResolver,
    ) as unknown[];

    expect(guards).toEqual([
      SessionGuard,
      AccountApprovedGuard,
      AppointmentsModuleEnabledGuard,
    ]);
  });
});
