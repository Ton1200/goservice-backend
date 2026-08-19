import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { ServiceRequestModel } from '../service-requests/models/service-request.model';
import { QuoteModel } from './models/quote.model';
import { SubmitQuoteInput } from './models/submit-quote-input.model';
import { AcceptQuoteService } from './services/accept-quote.service';
import { ListMyQuotesService } from './services/list-my-quotes.service';
import { ListQuotesForServiceRequestService } from './services/list-quotes-for-service-request.service';
import { RejectQuoteService } from './services/reject-quote.service';
import { SubmitQuoteService } from './services/submit-quote.service';
import { WithdrawQuoteService } from './services/withdraw-quote.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `ServiceRequestsResolver`. Every query/mutation requires `SessionGuard` +
 * `AccountApprovedGuard`, in that exact order. No operation here accepts
 * `customerProfileId`/`professionalProfileId`/`userId` as an argument —
 * ownership is always derived from `@CurrentUser()`.
 */
@Resolver()
export class QuotesResolver {
  constructor(
    private readonly submitQuoteService: SubmitQuoteService,
    private readonly withdrawQuoteService: WithdrawQuoteService,
    private readonly acceptQuoteService: AcceptQuoteService,
    private readonly rejectQuoteService: RejectQuoteService,
    private readonly listQuotesForServiceRequestService: ListQuotesForServiceRequestService,
    private readonly listMyQuotesService: ListMyQuotesService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => QuoteModel, {
    description:
      'Submits a new Quote against an OPEN ServiceRequest, owned by the authenticated Professional’s own ProfessionalProfile (never a client-supplied one).',
  })
  submitQuote(
    @CurrentUser() userId: string,
    @Args('input') input: SubmitQuoteInput,
  ): Promise<QuoteModel> {
    return this.submitQuoteService.submitQuote(userId, input);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => QuoteModel, {
    description:
      "Withdraws one of the authenticated Professional's own SENT Quotes.",
  })
  withdrawQuote(
    @CurrentUser() userId: string,
    @Args('quoteId', { type: () => ID }) quoteId: string,
  ): Promise<QuoteModel> {
    return this.withdrawQuoteService.withdrawQuote(userId, quoteId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => ServiceRequestModel, {
    description:
      "Accepts a Quote submitted against one of the authenticated Customer's own ServiceRequests, creating an Engagement and auto-rejecting every other SENT Quote on it. Returns the updated ServiceRequest (now ENGAGED).",
  })
  acceptQuote(
    @CurrentUser() userId: string,
    @Args('quoteId', { type: () => ID }) quoteId: string,
  ): Promise<ServiceRequestModel> {
    return this.acceptQuoteService.acceptQuote(userId, quoteId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => QuoteModel, {
    description:
      "Rejects a Quote submitted against one of the authenticated Customer's own ServiceRequests.",
  })
  rejectQuote(
    @CurrentUser() userId: string,
    @Args('quoteId', { type: () => ID }) quoteId: string,
  ): Promise<QuoteModel> {
    return this.rejectQuoteService.rejectQuote(userId, quoteId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [QuoteModel], {
    description:
      "Every Quote submitted against one of the authenticated Customer's own ServiceRequests.",
  })
  quotesForServiceRequest(
    @CurrentUser() userId: string,
    @Args('serviceRequestId', { type: () => ID }) serviceRequestId: string,
  ): Promise<QuoteModel[]> {
    return this.listQuotesForServiceRequestService.listQuotesForServiceRequest(
      userId,
      serviceRequestId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [QuoteModel], {
    description:
      "The authenticated Professional's own Quotes, most recent first. Always derived from the session — takes no arguments.",
  })
  myQuotes(@CurrentUser() userId: string): Promise<QuoteModel[]> {
    return this.listMyQuotesService.listMyQuotes(userId);
  }
}
