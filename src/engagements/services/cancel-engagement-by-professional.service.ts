import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementCancelConflict } from '../errors/engagement-cancel-conflict.error';
import { engagementNotCancellableByProfessional } from '../errors/engagement-not-cancellable-by-professional.error';

/**
 * Orchestrates `Mutation.cancelEngagementByProfessional` (GOS-117) — the
 * Professional owner of a still-open Engagement (`ACCEPTED` or
 * `IN_PROGRESS`) cancels it, recording a required `reason`: -> `CANCELLED`,
 * stamping `cancelledAt`/`cancelReason`. Exact mirror of
 * `CancelEngagementByCustomerService` (GOS-114) with ownership inverted —
 * same pre-reads (missing profile, ownership, wrong state) existing only for
 * a good specific error in the common, non-race case; the actual
 * concurrency guard is still `EngagementsRepository.cancelIfActive`'s
 * guarded CAS `updateMany` inside `prisma.$transaction`, reused COMPLETELY
 * UNCHANGED — it already guards `status IN (ACCEPTED, IN_PROGRESS)` with no
 * role/profile parameter at all, so there is nothing role-specific for the
 * repository to know. `count !== 1` still means this call lost a race
 * (`engagementCancelConflict()`, full rollback) — that error's code/message
 * are already role-neutral, so it is reused as-is rather than duplicated.
 *
 * Ownership is checked directly against the denormalized
 * `Engagement.professionalProfileId` — a missing Engagement, a caller with
 * no `ProfessionalProfile` at all (the Customer), and an unrelated
 * third-party Professional all collapse to the single anti-enumeration code
 * `engagementNotFound()`, reused unchanged from GOS-111/113/114/46.
 *
 * Deliberately ONE precheck error (`engagementNotCancellableByProfessional()`)
 * for all three disallowed states — same idiom as the Customer side, and its
 * own code (NOT shared with `engagementNotCancellableByCustomer()`) per this
 * ticket's own AC.
 *
 * Does NOT touch `src/engagement-chat/` — closing the coordination
 * conversation is GOS-107, out of scope here. Does NOT compute or move any
 * money — see `recordProfessionalCancellationRefund` below. No
 * `cancelledByRole` column and no new `EngagementsRepository` method exist
 * for this — nothing downstream needs to know "who cancelled" from the
 * `Engagement` row itself; this service's own distinct log event name
 * already captures that operationally.
 */
@Injectable()
export class CancelEngagementByProfessionalService {
  private readonly logger = new Logger(
    CancelEngagementByProfessionalService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async cancelEngagementByProfessional(
    userId: string,
    engagementId: string,
    reason: string,
  ): Promise<Engagement> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (
      !engagement ||
      !professionalProfile ||
      engagement.professionalProfileId !== professionalProfile.id
    ) {
      // Anti-enumeration — same code for "doesn't exist", "caller has no
      // ProfessionalProfile" (the Customer), and "not yours".
      throw engagementNotFound();
    }

    if (
      engagement.status !== EngagementStatus.ACCEPTED &&
      engagement.status !== EngagementStatus.IN_PROGRESS
    ) {
      throw engagementNotCancellableByProfessional();
    }

    await this.prisma.$transaction(async (tx) => {
      const cas = await this.engagementsRepository.cancelIfActive(
        tx,
        engagementId,
        reason,
      );
      if (cas.count !== 1) {
        throw engagementCancelConflict();
      }
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    // GOS-109 extension point: a Professional-initiated cancellation is
    // expected to require a FULL reimbursement to the Customer — unlike
    // `CancelEngagementByCustomerService.computeCustomerCancellationCharge`,
    // this business rule is already fixed (full refund, no charge amount to
    // calculate), so this stub is simpler. No payments/commission/ledger
    // table exists anywhere in this schema yet, so there is nothing for this
    // method to read, write, or even meaningfully simulate. This call exists
    // purely as the documented, exercised (not dead-code) seam GOS-109 will
    // replace with a `REFUND` ledger entry; its `null` return is
    // deliberately not surfaced on any GraphQL field.
    this.recordProfessionalCancellationRefund(updated!);

    this.logger.log({
      event: 'engagement_cancelled_by_professional',
      outcome: 'success',
      engagementId,
    });

    return updated!;
  }

  /**
   * GOS-109 extension point — see the call-site comment above. Always
   * returns `null` today; reserved for a future full-refund `REFUND` ledger
   * entry once a payments/commission ledger exists.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private recordProfessionalCancellationRefund(engagement: Engagement): null {
    return null;
  }
}
