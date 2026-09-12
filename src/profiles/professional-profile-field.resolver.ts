import { Float, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ReviewsRepository } from '../reviews/reviews.repository';
import { ProfessionalProfile } from './models/professional-profile.model';

/**
 * GOS-121 — resolves `ProfessionalProfile.averageRating`/`.reviewCount`, NOT
 * as plain `@Field()`s on `ProfessionalProfile` itself (that class carries
 * no rating-related column at all) — same "field resolved off a separate
 * `@Resolver()` class, not the base `@ObjectType()`" pattern
 * `ServiceRequestFieldResolver`/`PlatformSettingFieldResolver` already
 * establish.
 *
 * Lives in `src/profiles/` but injects `ReviewsRepository` DIRECTLY, as a
 * concrete provider class — this module never imports `ReviewsModule`
 * (a "resolver-bearing" module; importing it here risks the exact class of
 * leak this codebase's cross-module reuse already guards against, and would
 * also form a cycle: `ReviewsModule` itself imports `ProfilesModule`). Same
 * "reuse the concrete repository class directly, never import the
 * resolver-bearing Module" pattern `ServiceRequestFieldResolver` already
 * establishes for `QuotesRepository`/`EngagementsRepository`.
 *
 * Both ratings are computed via a dedicated query PER field, on demand — no
 * batching/Dataloader, same "no N+1 mitigation added speculatively" posture
 * already documented on `ServiceRequestFieldResolver`. Both count ratings
 * the instant they're submitted, NEVER waiting on comment moderation —
 * rating and comment-moderation are independent concerns (see `Review`'s
 * own header comment in `prisma/schema.prisma`).
 */
@Resolver(() => ProfessionalProfile)
export class ProfessionalProfileFieldResolver {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  @ResolveField(() => Float, {
    name: 'averageRating',
    nullable: true,
    description:
      'The average of every rating this Professional has RECEIVED from Customers, across all COMPLETED Engagements — counted immediately on submission, independent of comment moderation. null when this Professional has zero ratings yet.',
  })
  averageRating(
    @Parent() professionalProfile: ProfessionalProfile & { id: string },
  ): Promise<number | null> {
    return this.reviewsRepository.getAverageRatingForProfessional(
      professionalProfile.id,
    );
  }

  @ResolveField(() => Int, {
    name: 'reviewCount',
    description:
      'How many ratings this Professional has RECEIVED from Customers — counted immediately on submission, independent of comment moderation.',
  })
  reviewCount(
    @Parent() professionalProfile: ProfessionalProfile & { id: string },
  ): Promise<number> {
    return this.reviewsRepository.getReviewCountForProfessional(
      professionalProfile.id,
    );
  }
}
