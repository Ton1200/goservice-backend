import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_ACCEPT_CONFLICT_CODE = 'QUOTE_ACCEPT_CONFLICT';

/**
 * Thrown by `AcceptQuoteService` when either of the two guarded
 * `updateMany` CAS writes inside its transaction (`ServiceRequest`
 * OPEN->ENGAGED, `Quote` SENT->ACCEPTED) reports `count !== 1` — i.e. this
 * call LOST a race against another concurrent mutation (a double-accept, an
 * accept-vs-cancel, or an accept-vs-withdraw). NOT anti-enumeration: this
 * is a legitimate, expected outcome of concurrent access to a resource the
 * caller is already allowed to see (their own `ServiceRequest`, a `Quote`
 * already confirmed to be attached to it) — not a leak of any kind. See
 * the GOS-41 plan's decision #4/#5 for the full concurrency design.
 */
export function quoteAcceptConflict(): DomainException {
  return new DomainException(
    QUOTE_ACCEPT_CONFLICT_CODE,
    'This Quote could not be accepted — the ServiceRequest or Quote state changed concurrently.',
  );
}
