import { DomainException } from '../../common/errors/domain-exception';

const APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL_CODE =
  'APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL';

/**
 * Thrown by `AcceptAppointmentService` when the caller is the SAME party
 * that proposed the Appointment (`party.role === appointment.proposedByRole`)
 * — confirmed product decision: `acceptAppointment` may only be called by
 * the OTHER party, never the proposer. Same "self-resolve forbidden" shape
 * as `quotePriceProposalSelfResolveForbidden()`, checked BEFORE the state
 * checks below it, so a self-attempt gets this specific error regardless of
 * the Appointment's current state.
 */
export function appointmentCannotAcceptOwnProposal(): DomainException {
  return new DomainException(
    APPOINTMENT_CANNOT_ACCEPT_OWN_PROPOSAL_CODE,
    'You cannot accept your own Appointment proposal — it must be confirmed by the other party.',
  );
}
