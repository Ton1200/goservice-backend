import { Injectable } from '@nestjs/common';
import { AppointmentParty, Engagement } from '@prisma/client';
import { ProfilesRepository } from '../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { engagementNotFound } from '../engagement-chat/errors/engagement-not-found.error';

export interface AppointmentPartyResolution {
  role: AppointmentParty;
  engagement: Engagement;
  // Exactly one of these two is non-null, matching `role` — same
  // nullable-pair-of-profile-ids shape `EngagementChatAccessService`'s own
  // `EngagementChatPartyResolution` uses.
  customerProfileId: string | null;
  professionalProfileId: string | null;
}

/**
 * Shared by every Appointment operation
 * (`ProposeAppointmentService`/`AcceptAppointmentService`/
 * `CancelAppointmentService`/`ListAppointmentsByEngagementService`) — the
 * ONE place that decides whether a caller is a party to a given Engagement,
 * and which role they hold. Mirrors `EngagementChatAccessService.resolveParty`'s
 * exact shape and reasoning, adapted to Appointment: checks membership
 * directly against `Engagement.customerProfileId`/`professionalProfileId`
 * (no ServiceRequest/Quote hop needed — same reasoning
 * `EngagementChatAccessService`'s own header comment documents, since
 * `Engagement` already denormalizes both ids directly on itself).
 *
 * `EngagementsRepository` is reused here as a CONCRETE provider class (same
 * "never import the resolver-bearing Module" pattern
 * `EngagementChatAccessService` already establishes) —
 * `src/appointments/` never imports `EngagementsModule` itself. Reuses
 * `engagementNotFound()` from `src/engagement-chat/errors/` directly rather
 * than duplicating it — same anti-enumeration code, same reasoning: an
 * Appointment's ownership check is really an Engagement-membership check.
 */
@Injectable()
export class AppointmentAccessService {
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
  ): Promise<AppointmentPartyResolution> {
    const resolved = await this.tryResolveParty(userId, engagementId);
    if (!resolved) {
      throw engagementNotFound();
    }
    return resolved;
  }

  /**
   * Same lookup as `resolveParty`, but returns `null` instead of throwing —
   * used by `AcceptAppointmentService`/`CancelAppointmentService`, which
   * resolve an `Appointment` FIRST (throwing the Appointment's own
   * anti-enumeration `appointmentNotFound()` in that case, never this
   * method's `Engagement`-flavored code — see those services' own
   * comments).
   */
  async tryResolveParty(
    userId: string,
    engagementId: string,
  ): Promise<AppointmentPartyResolution | null> {
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
        role: AppointmentParty.CUSTOMER,
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
        role: AppointmentParty.PROFESSIONAL,
        engagement,
        customerProfileId: null,
        professionalProfileId: professionalProfile.id,
      };
    }

    return null;
  }
}
