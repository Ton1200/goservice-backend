import { Injectable } from '@nestjs/common';
import { Engagement, EngagementReviewParty } from '@prisma/client';
import { engagementNotFound } from '../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { ProfilesRepository } from '../profiles/profiles.repository';

export interface ReviewsPartyResolution {
  role: EngagementReviewParty;
  engagement: Engagement;
  // Exactly one of these two is non-null, matching `role` — same
  // nullable-pair-of-profile-ids shape `EngagementChatAccessService`/
  // `QuoteNegotiationAccessService` already establish.
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * `src/reviews/`'s own party-resolution lookup — mirrors
 * `EngagementChatAccessService.resolveParty`'s exact shape and reasoning,
 * adapted to `EngagementReviewParty`. Deliberately a SEPARATE class from
 * `EngagementChatAccessService`, not a reused import — each capability
 * module owns its own copy of this lookup, same "one per module, not
 * shared" precedent `QuoteNegotiationAccessService`/
 * `EngagementChatAccessService` already establish for each other (they are
 * near-identical in shape too, and neither reuses the other).
 *
 * `EngagementsRepository`/`ProfilesRepository` are reused here as CONCRETE
 * provider classes — `src/reviews/` never imports `EngagementsModule`/
 * `ProfilesModule`'s resolvers, same "reuse the concrete repository class
 * directly, never import the resolver-bearing Module" pattern this codebase
 * already establishes everywhere.
 */
@Injectable()
export class ReviewsAccessService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  /**
   * Throws the reused, anti-enumeration `engagementNotFound()` when the
   * Engagement doesn't exist, or the caller is neither its owning Customer
   * nor its Professional.
   */
  async resolveParty(
    userId: string,
    engagementId: string,
  ): Promise<ReviewsPartyResolution> {
    const resolved = await this.tryResolveParty(userId, engagementId);
    if (!resolved) {
      throw engagementNotFound();
    }
    return resolved;
  }

  async tryResolveParty(
    userId: string,
    engagementId: string,
  ): Promise<ReviewsPartyResolution | null> {
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (!engagement) {
      return null;
    }

    const [customerProfile, professionalProfile] = await Promise.all([
      this.profilesRepository.findCustomerProfileByUserId(userId),
      this.profilesRepository.findProfessionalProfileByUserId(userId),
    ]);

    if (
      customerProfile &&
      engagement.customerProfileId === customerProfile.id
    ) {
      return {
        role: EngagementReviewParty.CUSTOMER,
        engagement,
        customerProfileId: customerProfile.id,
        professionalProfileId: null,
      };
    }

    if (
      professionalProfile &&
      engagement.professionalProfileId === professionalProfile.id
    ) {
      return {
        role: EngagementReviewParty.PROFESSIONAL,
        engagement,
        customerProfileId: null,
        professionalProfileId: professionalProfile.id,
      };
    }

    return null;
  }
}
