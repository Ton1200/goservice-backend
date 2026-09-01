import { CanActivate, Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { appointmentsModuleDisabled } from '../errors/appointments-module-disabled.error';

// Dot-namespaced under the existing `customer.*` group — same convention
// `customer.chat.enabled` (Engagement Chat, GOS-46 follow-up) already
// establishes, so this key automatically renders under Customer >
// "Appointments" in the admin panel's Settings tree with zero frontend
// changes (`admin-panel/js/settings.js`'s `buildSettingsTree`/
// `humanizeSegment` derive the tree purely from a key's dot-path — no
// per-key special-casing exists or is needed). A sibling of
// `customer.chat.enabled`, NOT nested under it — Appointment and Engagement
// Chat are two independent capabilities that both happen to live under
// `customer.*`.
export const APPOINTMENTS_ENABLED_KEY = 'customer.appointments.enabled';

/**
 * The GLOBAL kill switch for the whole Appointment ("Coordinación de
 * Visita") capability — reads the `customer.appointments.enabled`
 * `PlatformSetting` via `PlatformSettingPort.isEnabled` (a real,
 * admin-toggleable row — see `prisma/seed.ts`'s own comment on this key).
 * Mirrors `EngagementChatModuleEnabledGuard` exactly (see that guard's own
 * header comment, `src/engagement-chat/guards/
 * engagement-chat-module-enabled.guard.ts`) — same mechanism, same
 * guard-ordering convention.
 *
 * Applied via `@UseGuards(SessionGuard, AccountApprovedGuard,
 * AppointmentsModuleEnabledGuard)` on every `AppointmentsResolver` method,
 * in that exact order — must run AFTER `SessionGuard`/`AccountApprovedGuard`
 * for consistency with the rest of this codebase's guard-ordering
 * convention, even though this guard itself doesn't read `req.userId`.
 *
 * Does NOT gate the platform-admin `adminAppointmentsByEngagement` read
 * query — same reasoning `EngagementChatModuleEnabledGuard`'s own header
 * comment documents for its sibling admin surface (an admin's ability to
 * audit existing Appointment history shouldn't disappear just because the
 * client-facing capability was toggled off), applied here per explicit
 * instruction for this follow-up. See `AdminAppointmentsResolver`'s own
 * header comment for the point-of-application of that decision.
 */
@Injectable()
export class AppointmentsModuleEnabledGuard implements CanActivate {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async canActivate(): Promise<boolean> {
    const enabled = await this.platformSettingPort.isEnabled(
      APPOINTMENTS_ENABLED_KEY,
    );
    if (!enabled) {
      throw appointmentsModuleDisabled();
    }
    return true;
  }
}
