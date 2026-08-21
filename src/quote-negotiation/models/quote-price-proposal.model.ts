import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { QuoteNegotiationParty } from './quote-negotiation-party.enum';
import { QuotePriceProposalStatus } from './quote-price-proposal-status.enum';

/**
 * A price counter-offer, always created alongside exactly one
 * `QuoteNegotiationMessage` (the comment that proposed it) — see
 * `QuoteNegotiationMessageModel.priceProposal`. Deliberately does NOT
 * expose the resolving/proposing profile ids directly — `proposedByRole`
 * already tells the caller which SIDE proposed it, and both parties on a
 * Quote already know each other's identity via `Quote.professionalProfile`/
 * the owning `ServiceRequest.customerProfile`, so no extra field is needed
 * here for the consumer-facing capability.
 */
@ObjectType('QuotePriceProposal')
export class QuotePriceProposalModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  quoteId!: string;

  @Field(() => ID)
  negotiationMessageId!: string;

  @Field(() => QuoteNegotiationParty)
  proposedByRole!: QuoteNegotiationParty;

  @Field(() => Int)
  proposedPrice!: number;

  @Field(() => QuotePriceProposalStatus)
  status!: QuotePriceProposalStatus;

  @Field(() => GraphQLISODateTime, { nullable: true })
  resolvedAt?: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
