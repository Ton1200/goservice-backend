import { Injectable } from '@nestjs/common';
import { Engagement } from '@prisma/client';
import { engagementNotFound } from '../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { ProfilesRepository } from '../profiles/profiles.repository';

// Plain string union, not a Prisma/GraphQL enum — this has nothing to do
// with `EngagementReviewParty` (`src/reviews/`'s own party-role enum);
// deliberately its own type, same "one per module, not shared" convention
// `QuoteNegotiationAccessService`/`EngagementChatAccessService`/
// `ReviewsAccessService` already establish for each other.
export type EngagementFinancialSummaryPartyRole = 'CUSTOMER' | 'PROFESSIONAL';

export interface EngagementFinancialSummaryPartyResolution {
  role: EngagementFinancialSummaryPartyRole;
  engagement: Engagement;
  // Exactly one of these two is non-null, matching `role` — same
  // nullable-pair-of-profile-ids shape `EngagementChatAccessService`/
  // `QuoteNegotiationAccessService`/`ReviewsAccessService` already
  // establish.
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * `src/engagement-financial-summary/`'s own party-resolution lookup —
 * mirrors `ReviewsAccessService.resolveParty`'s exact shape and reasoning.
 * Deliberately a SEPARATE class, not a reused import — each capability
 * module owns its own copy of this lookup, same "one per module, not
 * shared" precedent `ReviewsAccessService`/`QuoteNegotiationAccessService`/
 * `EngagementChatAccessService` already establish for each other (they are
 * near-identical in shape too, and none reuses another).
 *
 * `EngagementsRepository`/`ProfilesRepository` are reused here as CONCRETE
 * provider classes — `src/engagement-financial-summary/` never imports
 * `EngagementsModule`/`ProfilesModule`'s own resolvers, same "reuse the
 * concrete repository class directly, never import the resolver-bearing
 * Module" pattern this codebase already establishes everywhere.
 */
@Injectable()
export class EngagementFinancialSummaryAccessService {
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
  ): Promise<EngagementFinancialSummaryPartyResolution> {
    const resolved = await this.tryResolveParty(userId, engagementId);
    if (!resolved) {
      throw engagementNotFound();
    }
    return resolved;
  }

  async tryResolveParty(
    userId: string,
    engagementId: string,
  ): Promise<EngagementFinancialSummaryPartyResolution | null> {
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
        role: 'CUSTOMER',
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
        role: 'PROFESSIONAL',
        engagement,
        customerProfileId: null,
        professionalProfileId: professionalProfile.id,
      };
    }

    return null;
  }
}
