import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_NOT_SENT_CODE = 'QUOTE_NOT_SENT';

/**
 * Thrown by `WithdrawQuoteService`/`RejectQuoteService`, and by
 * `AcceptQuoteService`'s pre-read, when the target `Quote` (already
 * confirmed to belong to the caller — see `quoteNotFound()`) is not `SENT`.
 * Deliberately NOT anti-enumeration — same reasoning as
 * `serviceRequestAlreadyCancelled()`: the caller already knows this is
 * their own resource, so its current state is safe to disclose. Also
 * reported by the guarded CAS write itself (`count !== 1`) when a race is
 * lost between the pre-read and the write (e.g. withdraw-vs-accept) — see
 * each service's own comment.
 */
export function quoteNotSent(): DomainException {
  return new DomainException(QUOTE_NOT_SENT_CODE, 'This Quote is not SENT.');
}
