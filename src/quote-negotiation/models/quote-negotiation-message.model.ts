import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { QuoteNegotiationParty } from './quote-negotiation-party.enum';
import { QuotePriceProposalModel } from './quote-price-proposal.model';

/**
 * One comment (optionally carrying a price proposal) in the negotiation
 * thread attached to a Quote — GOS-53. `priceProposal` is a plain
 * `@Field()` (not a separate `@ResolveField`) — `QuoteNegotiationRepository`
 * always includes it in the same query, same pattern `QuoteModel.engagement`
 * already establishes.
 */
@ObjectType('QuoteNegotiationMessage')
export class QuoteNegotiationMessageModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  quoteId!: string;

  @Field(() => QuoteNegotiationParty)
  authorRole!: QuoteNegotiationParty;

  @Field()
  message!: string;

  // GOS-72 — optional single reference image on this message, set from a
  // consumed `MediaUploadRef` (see `PostQuoteNegotiationMessageService`).
  // A plain scalar column — no include/resolver needed; the admin
  // `adminQuoteNegotiationThread` surface (which reuses this exact type)
  // gets it for free, gated by its existing `QUOTE_NEGOTIATION_READ`.
  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => QuotePriceProposalModel, { nullable: true })
  priceProposal?: QuotePriceProposalModel | null;
}
