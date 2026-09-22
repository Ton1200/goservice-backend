import { registerEnumType } from '@nestjs/graphql';

/**
 * GOS-130 follow-up — `EngagementFinancialSummary.viewerRole`: makes which
 * side of `customer`/`professional` is populated on the response EXPLICIT,
 * rather than leaving the calling client to infer it from which of the two
 * nullable fields came back non-null. See `EngagementFinancialSummaryModel`'s
 * own header comment for the full role-restricted-visibility decision.
 */
export enum EngagementFinancialSummaryViewerRole {
  CUSTOMER = 'CUSTOMER',
  PROFESSIONAL = 'PROFESSIONAL',
}

registerEnumType(EngagementFinancialSummaryViewerRole, {
  name: 'EngagementFinancialSummaryViewerRole',
  description:
    'Which side of the Engagement the calling User is, for this financial summary — CUSTOMER (only `customer` is populated) or PROFESSIONAL (only `professional` is populated).',
});
