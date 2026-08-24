import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_NOT_FOUND_CODE = 'APPOINTMENT_NOT_FOUND';

/**
 * Thrown for ANY case where an `Appointment` id either does not exist AT
 * ALL, or exists but the caller is neither the `CustomerProfile` nor the
 * `ProfessionalProfile` on its owning `Engagement` — deliberately the SAME
 * code for both cases, same anti-enumeration discipline as
 * `engagementNotFound()`/`quoteNotFound()`.
 */
export function appointmentNotFound(): DomainException {
  return new DomainException(
    APPOINTMENT_NOT_FOUND_CODE,
    'Appointment not found.',
  );
}
