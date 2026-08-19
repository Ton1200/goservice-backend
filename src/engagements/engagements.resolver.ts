import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { EngagementModel } from './models/engagement.model';
import { ListMyEngagementsAsCustomerService } from './services/list-my-engagements-as-customer.service';
import { ListMyEngagementsAsProfessionalService } from './services/list-my-engagements-as-professional.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `ServiceRequestsResolver`/`QuotesResolver`. Both queries require
 * `SessionGuard` + `AccountApprovedGuard`, in that exact order, and take no
 * arguments — ownership is always derived from `@CurrentUser()`.
 */
@Resolver()
export class EngagementsResolver {
  constructor(
    private readonly listMyEngagementsAsCustomerService: ListMyEngagementsAsCustomerService,
    private readonly listMyEngagementsAsProfessionalService: ListMyEngagementsAsProfessionalService,
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
}
