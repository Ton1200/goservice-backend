import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { EngagementFinancialSummaryModel } from './models/engagement-financial-summary.model';
import { GetEngagementFinancialSummaryService } from './services/get-engagement-financial-summary.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `PaymentReceiptsResolver`/`ReviewsQueriesResolver`. `SessionGuard` +
 * `AccountApprovedGuard` only — no module-enabled kill switch (it only
 * reads `LedgerEntry`/`Engagement`/`Quote` rows that already exist, same
 * reasoning `myPaymentReceipts` already establishes). `engagementId` is the
 * only argument — role/ownership is always derived server-side, from
 * `@CurrentUser()` plus `EngagementFinancialSummaryAccessService`.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard)
export class EngagementFinancialSummaryResolver {
  constructor(
    private readonly getEngagementFinancialSummaryService: GetEngagementFinancialSummaryService,
  ) {}

  @Query(() => EngagementFinancialSummaryModel, {
    description:
      "A single Engagement's own financial summary — the caller's own side ONLY (see EngagementFinancialSummaryViewerRole/customer/professional's own descriptions for the role-restricted-visibility rule). Reflects the most recent financial event only (cash payment confirmed, a Customer cancellation charge, or a Professional cancellation refund); both eventType/occurredAt are null pre-event. A caller who is not a party to this Engagement gets ENGAGEMENT_NOT_FOUND (anti-enumeration).",
  })
  engagementFinancialSummary(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementFinancialSummaryModel> {
    return this.getEngagementFinancialSummaryService.getEngagementFinancialSummary(
      userId,
      engagementId,
    );
  }
}
