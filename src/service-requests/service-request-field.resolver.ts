import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { EngagementModel } from '../engagements/models/engagement.model';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { QuoteModel } from '../quotes/models/quote.model';
import { QuotesRepository } from '../quotes/quotes.repository';
import { ServiceRequestModel } from './models/service-request.model';

/**
 * GOS-41 — resolves `ServiceRequest.acceptedQuote`/`ServiceRequest.engagement`,
 * NOT as plain `@Field()`s on `ServiceRequestModel` itself (that class
 * carries no `acceptedQuoteId`/`Quote`/`Engagement` reference at all) — same
 * "field resolved off a separate `@Resolver()` class, not the base
 * `@ObjectType()`" pattern `PlatformSettingFieldResolver` already
 * establishes for `PlatformSettingModel.value`/`maskedPreview`.
 *
 * Lives in `service-requests/` but injects `QuotesRepository`/
 * `EngagementsRepository` DIRECTLY, as concrete provider classes — this
 * module never imports `QuotesModule`/`EngagementsModule` (both are
 * "resolver-bearing" modules; importing either here risks the exact class
 * of leak this codebase's `platform-admin` cross-schema reuse already
 * guards against, and — more importantly — `quotes/`/`engagements/` must
 * NEVER import `ServiceRequestsModule` back, so importing them here would
 * risk a cycle). Same "reuse the concrete repository class directly, never
 * import the resolver-bearing Module" pattern this codebase already
 * establishes.
 *
 * Two extra queries per `ServiceRequest` row when these fields are
 * actually requested (not a batched Dataloader) — acceptable for this
 * story's scale, same "no N+1 mitigation added speculatively" posture as
 * the rest of this codebase's GraphQL surface so far.
 */
@Resolver(() => ServiceRequestModel)
export class ServiceRequestFieldResolver {
  constructor(
    private readonly quotesRepository: QuotesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  @ResolveField(() => QuoteModel, {
    name: 'acceptedQuote',
    nullable: true,
    description:
      'The Quote accepted for this ServiceRequest, if any (only ever set once ServiceRequest.status is ENGAGED).',
  })
  async acceptedQuote(
    // `acceptedQuoteId` is a real scalar column returned by every
    // `ServiceRequestsRepository` query (Prisma includes every scalar field
    // by default alongside an `include`) — not declared as a `@Field()` on
    // `ServiceRequestModel` itself (never exposed directly, only via this
    // resolved field), so it's typed here rather than on that class.
    @Parent()
    serviceRequest: ServiceRequestModel & { acceptedQuoteId: string | null },
  ): Promise<QuoteModel | null> {
    if (!serviceRequest.acceptedQuoteId) {
      return null;
    }
    return this.quotesRepository.findById(serviceRequest.acceptedQuoteId);
  }

  @ResolveField(() => EngagementModel, {
    name: 'engagement',
    nullable: true,
    description:
      'The Engagement created for this ServiceRequest, if any (only ever set once ServiceRequest.status is ENGAGED).',
  })
  engagement(
    @Parent() serviceRequest: ServiceRequestModel,
  ): Promise<EngagementModel | null> {
    return this.engagementsRepository.findByServiceRequestId(serviceRequest.id);
  }
}
