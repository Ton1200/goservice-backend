import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { EngagementModel } from './models/engagement.model';
import { ConfirmEngagementCompletionService } from './services/confirm-engagement-completion.service';
import { ListMyEngagementsAsCustomerService } from './services/list-my-engagements-as-customer.service';
import { ListMyEngagementsAsProfessionalService } from './services/list-my-engagements-as-professional.service';
import { MarkEngagementWorkFinishedService } from './services/mark-engagement-work-finished.service';
import { StartEngagementWorkService } from './services/start-engagement-work.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `ServiceRequestsResolver`/`QuotesResolver`. Every operation requires
 * `SessionGuard` + `AccountApprovedGuard`, in that exact order, applied
 * per-method (this resolver is not decorated at the class level). The two
 * read queries take no arguments; the three GOS-111/GOS-113 work-execution
 * mutations take only `engagementId` — ownership/role is always derived
 * from `@CurrentUser()`, never passed in.
 */
@Resolver()
export class EngagementsResolver {
  constructor(
    private readonly listMyEngagementsAsCustomerService: ListMyEngagementsAsCustomerService,
    private readonly listMyEngagementsAsProfessionalService: ListMyEngagementsAsProfessionalService,
    private readonly startEngagementWorkService: StartEngagementWorkService,
    private readonly markEngagementWorkFinishedService: MarkEngagementWorkFinishedService,
    private readonly confirmEngagementCompletionService: ConfirmEngagementCompletionService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [EngagementModel], {
    description:
      "The authenticated Customer's own Engagements, most recent first. Always derived from the session — takes no arguments.",
  })
  myEngagementsAsCustomer(
    @CurrentUser() userId: string,
  ): Promise<EngagementModel[]> {
    return this.listMyEngagementsAsCustomerService.listMyEngagementsAsCustomer(
      userId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [EngagementModel], {
    description:
      "The authenticated Professional's own Engagements, most recent first. Always derived from the session — takes no arguments.",
  })
  myEngagementsAsProfessional(
    @CurrentUser() userId: string,
  ): Promise<EngagementModel[]> {
    return this.listMyEngagementsAsProfessionalService.listMyEngagementsAsProfessional(
      userId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => EngagementModel, {
    description:
      'The Professional owner of an Engagement reports they have started the work: ACCEPTED → IN_PROGRESS, stamping startedAt. Requires the Engagement to have at least one CONFIRMED Appointment (ENGAGEMENT_HAS_NO_CONFIRMED_APPOINTMENT otherwise). A caller who is not this Engagement’s Professional — the Customer or a third party — gets ENGAGEMENT_NOT_FOUND (anti-enumeration). Wrong current state → ENGAGEMENT_NOT_ACCEPTED; lost concurrent race → ENGAGEMENT_WORK_START_CONFLICT.',
  })
  startEngagementWork(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementModel> {
    return this.startEngagementWorkService.startEngagementWork(
      userId,
      engagementId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => EngagementModel, {
    description:
      'The Professional owner reports the work is finished and awaiting Customer confirmation: IN_PROGRESS → PENDING_CUSTOMER_CONFIRMATION, stamping finishedAt. Non-owner → ENGAGEMENT_NOT_FOUND (anti-enumeration). Wrong current state → ENGAGEMENT_NOT_IN_PROGRESS; lost concurrent race → ENGAGEMENT_WORK_FINISH_CONFLICT.',
  })
  markEngagementWorkFinished(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementModel> {
    return this.markEngagementWorkFinishedService.markEngagementWorkFinished(
      userId,
      engagementId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => EngagementModel, {
    description:
      'The Customer owner of an Engagement confirms the work is done: PENDING_CUSTOMER_CONFIRMATION → COMPLETED. A caller who is not this Engagement’s Customer — the Professional or a third party — gets ENGAGEMENT_NOT_FOUND (anti-enumeration). Wrong current state → ENGAGEMENT_NOT_PENDING_CUSTOMER_CONFIRMATION; lost concurrent race → ENGAGEMENT_COMPLETION_CONFLICT.',
  })
  confirmEngagementCompletion(
    @CurrentUser() userId: string,
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementModel> {
    return this.confirmEngagementCompletionService.confirmEngagementCompletion(
      userId,
      engagementId,
    );
  }
}
