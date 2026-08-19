import { DomainException } from '../../common/errors/domain-exception';

const SERVICE_REQUEST_NOT_OPEN_CODE = 'SERVICE_REQUEST_NOT_OPEN';

/**
 * Thrown by `SubmitQuoteService`/`AcceptQuoteService`'s pre-read when the
 * target `ServiceRequest` exists (already confirmed by
 * `serviceRequestNotFound`'s own check, where applicable) but is not
 * `OPEN`. Deliberately NOT anti-enumeration: a Professional legitimately
 * discovers this `ServiceRequest` id via `compatibleServiceRequests` (a
 * Discovery query, not an ownership boundary), so disclosing its actual
 * status here leaks nothing a Professional couldn't already see. See the
 * GOS-41 plan's decision #9.
 */
export function serviceRequestNotOpen(): DomainException {
  return new DomainException(
    SERVICE_REQUEST_NOT_OPEN_CODE,
    'This ServiceRequest is not OPEN.',
  );
}
