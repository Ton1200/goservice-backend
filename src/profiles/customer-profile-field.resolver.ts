import { Float, Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ReviewsRepository } from '../reviews/reviews.repository';
import { CustomerProfile } from './models/customer-profile.model';

/**
 * GOS-121 follow-up (human-requested, added after the initial ship) —
 * resolves `CustomerProfile.averageRating`/`.reviewCount`, the exact mirror
 * of `ProfessionalProfileFieldResolver` (same file's own header comment
 * applies here verbatim: separate `@Resolver()` class rather than a plain
 * `@Field()`, `ReviewsRepository` reused as a concrete provider to avoid a
 * cycle with `ReviewsModule`, one dedicated query per field with no
 * batching).
 *
 * Ratings a Customer RECEIVES come from the Professional side of a
 * completed Engagement (`authorRole: PROFESSIONAL`) — the mirror image of
 * the Professional's own `authorRole: CUSTOMER` filter. Counted the instant
 * they're submitted, independent of comment moderation, same as the
 * Professional side.
 */
@Resolver(() => CustomerProfile)
export class CustomerProfileFieldResolver {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  @ResolveField(() => Float, {
    name: 'averageRating',
    nullable: true,
    description:
      'The average of every rating this Customer has RECEIVED from Professionals, across all COMPLETED Engagements — counted immediately on submission, independent of comment moderation. null when this Customer has zero ratings yet.',
  })
  averageRating(
    @Parent() customerProfile: CustomerProfile & { id: string },
  ): Promise<number | null> {
    return this.reviewsRepository.getAverageRatingForCustomer(
      customerProfile.id,
    );
  }

  @ResolveField(() => Int, {
    name: 'reviewCount',
    description:
      'How many ratings this Customer has RECEIVED from Professionals — counted immediately on submission, independent of comment moderation.',
  })
  reviewCount(
    @Parent() customerProfile: CustomerProfile & { id: string },
  ): Promise<number> {
    return this.reviewsRepository.getReviewCountForCustomer(customerProfile.id);
  }
}
