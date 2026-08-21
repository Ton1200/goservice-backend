import { Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { QuoteModel } from './models/quote.model';

/**
 * GOS-53 follow-up — resolves `Quote.finalPrice`, the real, effective price
 * of a Quote (`negotiatedPrice ?? price`). `Engagement` stores no price of
 * its own; every consumer of "what does this Quote actually cost" must go
 * through this derivation rather than reading `price` directly (which stays
 * the ORIGINAL quoted price forever — see `QuoteModel.price`'s own schema
 * comment) — see `AcceptQuoteService`'s header comment for the bug this
 * closes.
 *
 * A `@ResolveField()` off a separate `@Resolver()` class, not a plain
 * `@Field()` on `QuoteModel` itself, same "field resolved off a separate
 * `@Resolver()` class" pattern `PlatformSettingFieldResolver`/
 * `ServiceRequestFieldResolver` already establish — unlike those two,
 * though, this needs no repository injection at all: `price`/
 * `negotiatedPrice` are already plain `@Field()`s populated by every
 * `QuotesRepository` query, so this is a pure, synchronous computation off
 * `@Parent()`, no extra DB round-trip.
 */
@Resolver(() => QuoteModel)
export class QuoteFieldResolver {
  @ResolveField(() => Int, {
    name: 'finalPrice',
    description:
      'The effective price of this Quote: negotiatedPrice if one was agreed via the Quote Negotiation thread, otherwise the original price. Never null.',
  })
  finalPrice(@Parent() quote: QuoteModel): number {
    return quote.negotiatedPrice ?? quote.price;
  }
}
