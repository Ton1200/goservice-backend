import { DomainException } from '../../common/errors/domain-exception';

const ENGAGEMENT_REVIEW_ALREADY_SUBMITTED_CODE =
  'ENGAGEMENT_REVIEW_ALREADY_SUBMITTED';

/**
 * Thrown by `SubmitEngagementReviewService` when the caller has already
 * submitted a Review for this Engagement, in their current role — caught
 * from a Prisma `P2002` on `Review`'s own `@@unique([engagementId,
 * authorRole])`, NOT a pre-check `findFirst`. See that service's own header
 * comment for why this is the first place in this codebase that catches
 * `P2002` directly (a deliberate, ticket-instructed exception to this
 * repo's usual pre-check/CAS convention — the unique constraint alone is
 * the guarantee here, no transactional CAS needed).
 */
export function engagementReviewAlreadySubmitted(): DomainException {
  return new DomainException(
    ENGAGEMENT_REVIEW_ALREADY_SUBMITTED_CODE,
    'You have already submitted a review for this Engagement.',
  );
}
