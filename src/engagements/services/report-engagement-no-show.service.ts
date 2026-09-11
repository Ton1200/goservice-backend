import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementNotReportableForNoShow } from '../errors/engagement-not-reportable-for-no-show.error';

/**
 * Orchestrates `Mutation.reportEngagementNoShow` (GOS-117) — EITHER party on
 * a still-open Engagement (`ACCEPTED` or `IN_PROGRESS`) reports that the
 * OTHER party did not show up, recording a required `reason`. This is
 * deliberately a PURE trust/reliability counter: it increments the OTHER
 * party's `noShowReportedCount` on their `CustomerProfile`/
 * `ProfessionalProfile` row and nothing else. It does NOT change
 * `Engagement.status` — per this ticket's own AC there is zero automatic
 * consequence (no blocking, no threshold logic) — the roadmap explicitly
 * says to start with only the reliability record. Does NOT touch
 * `src/engagement-chat/` (GOS-107, out of scope).
 *
 * Which party is reporting is INFERRED, never taken as a GraphQL argument:
 * both of the caller's possible profile types are looked up (a User may
 * legitimately hold both a `CustomerProfile` and a `ProfessionalProfile` —
 * see `ProfessionalProfile.locationSharingEnabled`'s own schema comment) and
 * compared against the Engagement's own denormalized
 * `customerProfileId`/`professionalProfileId`. A caller who is a party to
 * NEITHER side — nonexistent engagement, caller holds no matching profile at
 * all, or an unrelated third party — collapses to the single
 * anti-enumeration `engagementNotFound()`, same code reused from
 * GOS-111/113/114/46.
 *
 * No `prisma.$transaction` here, unlike the cancellation services: this is
 * a single, standalone write to exactly one row of one table
 * (`CustomerProfile` OR `ProfessionalProfile`, never both, never paired with
 * any other write) — there is nothing to make atomic WITH. A plain `update`
 * (not a guarded CAS `updateMany`) is correct: there is no precondition to
 * race against, since a repeated no-show report from the same party on the
 * same Engagement is an explicitly ALLOWED, undeduplicated outcome per this
 * ticket's AC, not a conflict to guard against. `EngagementsRepository`
 * itself gains no new method — the increment goes through two new
 * `ProfilesRepository` methods instead, since `EngagementsRepository` must
 * never touch profile tables (this codebase's per-table repository-ownership
 * rule — see both repositories' own header comments).
 *
 * `reason` is required by the GraphQL contract (matching the cancellation
 * mutations' own shape) but is NOT persisted anywhere — this ticket's AC
 * only specifies a `noShowReportedCount` counter column, no `noShowReason`
 * column.
 *
 * Returns the Engagement object already in hand from the ownership lookup —
 * no re-fetch, since nothing on the `Engagement` row ever changes here.
 */
@Injectable()
export class ReportEngagementNoShowService {
  private readonly logger = new Logger(ReportEngagementNoShowService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async reportEngagementNoShow(
    userId: string,
    engagementId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    reason: string,
  ): Promise<Engagement> {
    const [customerProfile, professionalProfile, engagement] =
      await Promise.all([
        this.profilesRepository.findCustomerProfileByUserId(userId),
        this.profilesRepository.findProfessionalProfileByUserId(userId),
        this.engagementsRepository.findById(engagementId),
      ]);

    const isCustomer =
      !!engagement &&
      !!customerProfile &&
      engagement.customerProfileId === customerProfile.id;
    const isProfessional =
      !!engagement &&
      !!professionalProfile &&
      engagement.professionalProfileId === professionalProfile.id;
    if (!engagement || (!isCustomer && !isProfessional)) {
      // Anti-enumeration — same code for "doesn't exist" and "caller is not
      // a party to this Engagement at all".
      throw engagementNotFound();
    }

    if (
      engagement.status !== EngagementStatus.ACCEPTED &&
      engagement.status !== EngagementStatus.IN_PROGRESS
    ) {
      throw engagementNotReportableForNoShow();
    }

    if (isCustomer) {
      await this.profilesRepository.incrementProfessionalNoShowReportedCount(
        engagement.professionalProfileId,
      );
    } else {
      await this.profilesRepository.incrementCustomerNoShowReportedCount(
        engagement.customerProfileId,
      );
    }

    this.logger.log({
      event: 'engagement_no_show_reported',
      outcome: 'success',
      engagementId,
      reportedByRole: isCustomer ? 'CUSTOMER' : 'PROFESSIONAL',
    });

    // Engagement.status is deliberately untouched — see this class's own
    // header comment — so the object already in hand is still accurate;
    // no re-fetch needed.
    return engagement;
  }
}
