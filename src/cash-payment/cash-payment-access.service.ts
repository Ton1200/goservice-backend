import { Injectable } from '@nestjs/common';
import { Engagement } from '@prisma/client';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { engagementNotFound } from '../engagement-chat/errors/engagement-not-found.error';

/**
 * Which role the caller holds on a given Engagement's cash-payment
 * confirmation — a plain, in-memory-only union, NOT a Prisma enum: unlike
 * `AppointmentParty`/`EngagementReviewParty`, nothing in
 * `CashPaymentConfirmation`'s own schema stores "who confirmed" as a role
 * column (it stores two independent `customerConfirmedAt`/
 * `professionalConfirmedAt` timestamps instead — see that model's own
 * header comment) — there is no persistence reason for a stored enum here.
 */
export type CashPaymentParty = 'CUSTOMER' | 'PROFESSIONAL';

export interface CashPaymentPartyResolution {
  role: CashPaymentParty;
  engagement: Engagement;
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * Shared by every Cash Payment operation (`ConfirmCashPaymentService` today)
 * — the ONE place that decides whether a caller is a party to a given
 * Engagement, and which role they hold. Mirrors
 * `AppointmentAccessService.resolveParty`'s exact shape and reasoning:
 * checks membership directly against `Engagement.customerProfileId`/
 * `professionalProfileId` (no ServiceRequest/Quote hop needed — `Engagement`
 * already denormalizes both ids directly on itself).
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "never import the resolver-bearing Module" pattern
 * `AppointmentAccessService`/`EngagementChatAccessService` already
 * establish) — `src/cash-payment/` never imports `EngagementsModule` itself.
 * Reuses `engagementNotFound()` from `src/engagement-chat/errors/` directly
 * rather than duplicating it — same anti-enumeration code, same reasoning: a
 * cash-payment confirmation's ownership check is really an
 * Engagement-membership check.
 */
@Injectable()
export class CashPaymentAccessService {
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
  ): Promise<CashPaymentPartyResolution> {
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (!engagement) {
      throw engagementNotFound();
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

    throw engagementNotFound();
  }
}
