import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_CANCELLABLE_BY_PROFESSIONAL_CODE =
  'ENGAGEMENT_NOT_CANCELLABLE_BY_PROFESSIONAL';

/**
 * Thrown by `CancelEngagementByProfessionalService`'s pre-transaction check
 * when the Engagement is not currently `ACCEPTED` or `IN_PROGRESS` — i.e. it
 * is already `PENDING_CUSTOMER_CONFIRMATION`, `COMPLETED`, or already
 * `CANCELLED`. Deliberately its OWN code, NOT shared with
 * `engagementNotCancellableByCustomer()` — GOS-117's own AC calls for a
 * role-specific precheck error on this side, mirroring GOS-114's Customer
 * one exactly, same "one code covering all three disallowed states" idiom.
 * Deliberately DISTINCT from `ENGAGEMENT_CANCEL_CONFLICT` (a lost CAS race
 * where the pre-read looked fine a moment earlier) — that error IS reused
 * unchanged across both roles since its code/message are already
 * role-neutral (see `CancelEngagementByProfessionalService`'s own comment).
 */
export function engagementNotCancellableByProfessional(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_CANCELLABLE_BY_PROFESSIONAL_CODE,
    'This Engagement is not ACCEPTED or IN_PROGRESS — it cannot be cancelled.',
  );
}
