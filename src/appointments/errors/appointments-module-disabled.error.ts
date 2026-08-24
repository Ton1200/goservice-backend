import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENTS_MODULE_DISABLED_CODE = 'APPOINTMENTS_MODULE_DISABLED';

/**
 * Thrown by `AppointmentsModuleEnabledGuard` when the
 * `customer.appointments.enabled` `PlatformSetting` currently resolves to
 * `false` — the GLOBAL kill switch for this whole capability
 * (`proposeAppointment`/`acceptAppointment`/`cancelAppointment`/
 * `appointmentsByEngagement`). Applied to every resolver method in
 * `AppointmentsResolver`, same "one guard, every operation" convention as
 * `EngagementChatModuleEnabledGuard` (see that guard's own header comment,
 * `src/engagement-chat/guards/engagement-chat-module-enabled.guard.ts`, for
 * the precedent this mirrors).
 */
export function appointmentsModuleDisabled(): DomainException {
  return new DomainException(
    APPOINTMENTS_MODULE_DISABLED_CODE,
    'Appointment is currently disabled.',
  );
}
