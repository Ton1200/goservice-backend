import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_NOT_FOUND_CODE = 'ENGAGEMENT_NOT_FOUND';

/**
 * Thrown for ANY case where an `Engagement` id either does not exist AT
 * ALL, or exists but the caller is neither its `CustomerProfile` nor its
 * `ProfessionalProfile` — deliberately the SAME code for both cases, same
 * anti-enumeration discipline as `quotes/errors/quote-not-found.error.ts`'s
 * own `quoteNotFound()` (GOS-53's own precedent for this exact shape of
 * "belongs to one of two parties" access check).
 */
export function engagementNotFound(): DomainException {
  return new DomainException(
    ENGAGEMENT_NOT_FOUND_CODE,
    'Engagement not found.',
  );
}
