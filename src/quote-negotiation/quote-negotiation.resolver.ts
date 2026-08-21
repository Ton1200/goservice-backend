import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { QuoteModel } from '../quotes/models/quote.model';
import { QuoteNegotiationModuleEnabledGuard } from './guards/quote-negotiation-module-enabled.guard';
import { QuoteNegotiationMessageModel } from './models/quote-negotiation-message.model';
import { PostQuoteNegotiationMessageInput } from './models/post-quote-negotiation-message-input.model';
import { QuotePriceProposalModel } from './models/quote-price-proposal.model';
import { AcceptQuotePriceProposalService } from './services/accept-quote-price-proposal.service';
import { ListQuoteNegotiationMessagesService } from './services/list-quote-negotiation-messages.service';
import { PostQuoteNegotiationMessageService } from './services/post-quote-negotiation-message.service';
import { RejectQuotePriceProposalService } from './services/reject-quote-price-proposal.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `QuotesResolver`. Every query/mutation requires `SessionGuard` +
 * `AccountApprovedGuard` + `QuoteNegotiationModuleEnabledGuard`, in that
 * exact order. No operation accepts `customerProfileId`/
 * `professionalProfileId`/`userId` as an argument — ownership/role is
 * always derived server-side from `@CurrentUser()` +
 * `QuoteNegotiationAccessService`.
 */
@Resolver()
@UseGuards(
  SessionGuard,
  AccountApprovedGuard,
  QuoteNegotiationModuleEnabledGuard,
)
export class QuoteNegotiationResolver {
  constructor(
    private readonly postQuoteNegotiationMessageService: PostQuoteNegotiationMessageService,
    private readonly acceptQuotePriceProposalService: AcceptQuotePriceProposalService,
    private readonly rejectQuotePriceProposalService: RejectQuotePriceProposalService,
    private readonly listQuoteNegotiationMessagesService: ListQuoteNegotiationMessagesService,
  ) {}

  @Mutation(() => QuoteNegotiationMessageModel, {
    description:
      'Posts a comment (optionally carrying a price proposal) in the negotiation thread of a SENT Quote the caller is a party to (the owning Customer or the submitting Professional).',
  })
  postQuoteNegotiationMessage(
    @CurrentUser() userId: string,
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Args('input') input: PostQuoteNegotiationMessageInput,
  ): Promise<QuoteNegotiationMessageModel> {
    return this.postQuoteNegotiationMessageService.postMessage(
      userId,
      quoteId,
      input,
    );
  }

  @Mutation(() => QuoteModel, {
    description:
      "Accepts a PENDING QuotePriceProposal made by the CALLER'S counterparty on a SENT Quote — never the caller's own proposal. Sets Quote.negotiatedPrice and returns the updated Quote.",
  })
  acceptQuotePriceProposal(
    @CurrentUser() userId: string,
    @Args('proposalId', { type: () => ID }) proposalId: string,
  ): Promise<QuoteModel> {
    return this.acceptQuotePriceProposalService.accept(userId, proposalId);
  }

  @Mutation(() => QuotePriceProposalModel, {
    description:
      "Rejects a PENDING QuotePriceProposal made by the CALLER'S counterparty on a SENT Quote — never the caller's own proposal.",
  })
  rejectQuotePriceProposal(
    @CurrentUser() userId: string,
    @Args('proposalId', { type: () => ID }) proposalId: string,
  ): Promise<QuotePriceProposalModel> {
    return this.rejectQuotePriceProposalService.reject(userId, proposalId);
  }

  @Query(() => [QuoteNegotiationMessageModel], {
    description:
      'The full negotiation thread of a Quote the caller is a party to, oldest first.',
  })
  quoteNegotiationMessages(
    @CurrentUser() userId: string,
    @Args('quoteId', { type: () => ID }) quoteId: string,
  ): Promise<QuoteNegotiationMessageModel[]> {
    return this.listQuoteNegotiationMessagesService.listMessages(
      userId,
      quoteId,
    );
  }
}
