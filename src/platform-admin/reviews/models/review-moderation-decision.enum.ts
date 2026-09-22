import { registerEnumType } from '@nestjs/graphql';

/**
 * GOS-121 — the argument shape `moderateEngagementReviewComment` accepts. A
 * GraphQL-only enum (no matching Prisma enum) — deliberately NOT reusing
 * `ReviewCommentModerationStatus` (which also has `PENDING`) for this
 * argument: an admin decision can only ever be APPROVE or REJECT, never
 * "set back to PENDING" — same "a GraphQL-only enum narrower than the
 * persistence enum" precedent `AdminProfileKind` establishes for a
 * different reason (no matching Prisma enum at all there).
 */
export enum ReviewModerationDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

registerEnumType(ReviewModerationDecision, {
  name: 'ReviewModerationDecision',
  description:
    'An admin decision on a PENDING review comment — APPROVE or REJECT. Never PENDING: that value only exists on ReviewCommentModerationStatus, never as an admin-submittable decision.',
});
