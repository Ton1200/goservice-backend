import { Injectable } from '@nestjs/common';
import { Engagement, EngagementChatParty } from '@prisma/client';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { engagementNotFound } from './errors/engagement-not-found.error';

export interface EngagementChatPartyResolution {
  role: EngagementChatParty;
  engagement: Engagement;
  // Exactly one of these two is non-null, matching `role` — same
  // nullable-pair-of-profile-ids shape `EngagementChatMessage` itself uses,
  // mirroring `QuoteNegotiationPartyResolution`'s own shape.
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * Shared by both Engagement Chat operations
 * (`SendEngagementMessageService`/`ListEngagementMessagesService`) — the ONE
 * place that decides whether a caller is a party to a given Engagement, and
 * which role they hold. Mirrors
 * `QuoteNegotiationAccessService.resolveParty`'s exact shape and reasoning,
 * adapted to `Engagement` (which already denormalizes both
 * `customerProfileId`/`professionalProfileId` directly on itself — see that
 * model's own header comment — so, unlike `QuoteNegotiationAccessService`,
 * this never needs a second lookup through `ServiceRequest`/`Quote`).
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "never import the resolver-bearing Module" pattern
 * `QuoteNegotiationAccessService` already establishes for
 * `QuotesRepository`/`ServiceRequestsRepository`) — `src/engagement-chat/`
 * never imports `EngagementsModule` itself.
 */
@Injectable()
export class EngagementChatAccessService {
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
  ): Promise<EngagementChatPartyResolution> {
    const resolved = await this.tryResolveParty(userId, engagementId);
    if (!resolved) {
      throw engagementNotFound();
    }
    return resolved;
  }

  /**
   * Same lookup as `resolveParty`, but returns `null` instead of throwing —
   * kept for parity with `QuoteNegotiationAccessService.tryResolveParty`,
   * even though (unlike that service's two write operations, which resolve
   * a different entity first) neither current Engagement Chat caller needs
   * the non-throwing form today.
   */
  async tryResolveParty(
    userId: string,
    engagementId: string,
  ): Promise<EngagementChatPartyResolution | null> {
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
        role: EngagementChatParty.CUSTOMER,
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
        role: EngagementChatParty.PROFESSIONAL,
        engagement,
        customerProfileId: null,
        professionalProfileId: professionalProfile.id,
      };
    }

    return null;
  }
}
