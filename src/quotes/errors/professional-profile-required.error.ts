import { DomainException } from '../../common/errors/domain-exception';

const PROFESSIONAL_PROFILE_REQUIRED_CODE = 'PROFESSIONAL_PROFILE_REQUIRED';

/**
 * Thrown by `SubmitQuoteService`/`WithdrawQuoteService`/`ListMyQuotesService`
 * when the authenticated user has no `ProfessionalProfile` yet. Same
 * "should never actually happen once `AccountApprovedGuard` already
 * confirmed `APPROVED`, but treated defensively" posture as
 * `customerProfileRequired()` (`service-requests/errors/`).
 */
export function professionalProfileRequired(): DomainException {
  return new DomainException(
    PROFESSIONAL_PROFILE_REQUIRED_CODE,
    'This action requires a ProfessionalProfile.',
  );
}
