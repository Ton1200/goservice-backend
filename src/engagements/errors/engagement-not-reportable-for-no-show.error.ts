import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_REPORTABLE_FOR_NO_SHOW_CODE =
  'ENGAGEMENT_NOT_REPORTABLE_FOR_NO_SHOW';

/**
 * Thrown by `ReportEngagementNoShowService`'s pre-write check when the
 * Engagement is not currently `ACCEPTED` or `IN_PROGRESS` — the same two
 * allowed states as both cancellation mutations (GOS-114/GOS-117), reported
 * by EITHER party. One shared code covering every disallowed state, same
 * "single precheck error, not split per-state" idiom as
 * `engagementNotCancellableByCustomer()` /
 * `engagementNotCancellableByProfessional()`. There is no CAS/conflict
 * counterpart for this mutation — see `ReportEngagementNoShowService`'s own
 * header comment for why a plain `update` (not a guarded `updateMany`) is
 * safe here.
 */
export function engagementNotReportableForNoShow(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_REPORTABLE_FOR_NO_SHOW_CODE,
    'This Engagement is not ACCEPTED or IN_PROGRESS — a no-show cannot be reported.',
  );
}
