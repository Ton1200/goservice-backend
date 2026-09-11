import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT_CODE =
  'ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT';

/**
 * Thrown by `StartEngagementWorkService` when the Engagement has zero
 * `Appointment` rows in `status = CONFIRMED` — a Professional may only report
 * "empecé el trabajo" once a visit has actually been agreed
 * (`AppointmentStatus.CONFIRMED`). Checked pre-transaction via
 * `AppointmentsRepository.countConfirmedByEngagementId`, mirroring
 * `AcceptQuoteService`'s pre-transaction `quoteHasPendingPriceProposal` gate;
 * the tiny check -> CAS race (the appointment gets cancelled in between) is a
 * known, accepted race of the same class.
 *
 * Open question (GOS-111): whether the CONFIRMED Appointment's `startsAt` must
 * already be in the past. Today it is enough that an Appointment is CONFIRMED.
 */
export function engagementHasNoConfirmedAppointment(): DomainException {
  return new DomainException(
    ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT_CODE,
    'This Engagement has no CONFIRMED Appointment — work cannot be started.',
  );
}
