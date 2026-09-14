import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES } from '../../engagement-chat/constants/engagement-lifecycle-system-messages.constants';
import { EmitEngagementLifecycleSystemMessageService } from '../../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { RecordProfessionalCancellationRefundService } from '../../ledger/services/record-professional-cancellation-refund.service';
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
 * for all three disallowed states, per this ticket's own AC.
 *
 * Does NOT touch `src/engagement-chat/` — closing the coordination
 * conversation is GOS-107, out of scope here. No `cancelledByRole` column
 * and no new `EngagementsRepository` method exist for this — nothing
 * downstream needs to know "who cancelled" from the `Engagement` row
 * itself; this service's own distinct log event name already captures that
 * operationally.
 *
 * **GOS-109**: same restructuring as `CancelEngagementByCustomerService` —
 * the pre-cancel ownership/state read now uses
 * `EngagementsRepository.findByIdWithBillingContext`; inside the SAME
 * `prisma.$transaction` as the CAS write,
 * `recordProfessionalCancellationRefundService.record` writes DEC-008's
 * unconditional full-refund `REFUND` ledger entry — a ledger-write failure
 * rolls back the whole cancellation.
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
    private readonly emitEngagementLifecycleSystemMessageService: EmitEngagementLifecycleSystemMessageService,
    private readonly recordProfessionalCancellationRefundService: RecordProfessionalCancellationRefundService,
  ) {}

  async cancelEngagementByProfessional(
    userId: string,
    engagementId: string,
    reason: string,
  ): Promise<Engagement> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    const engagement =
      await this.engagementsRepository.findByIdWithBillingContext(engagementId);
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

    const quotedPrice =
      engagement.quote.negotiatedPrice ?? engagement.quote.price;
    const currency = CURRENCY_BY_COUNTRY[engagement.customerProfile.country];

    await this.prisma.$transaction(async (tx) => {
      const cas = await this.engagementsRepository.cancelIfActive(
        tx,
        engagementId,
        reason,
      );
      if (cas.count !== 1) {
        throw engagementCancelConflict();
      }

      // GOS-125 — emits the "Trabajo cancelado por el profesional" system
      // chat message inside this SAME transaction — see
      // `StartEngagementWorkService`'s identical note.
      await this.emitEngagementLifecycleSystemMessageService.emit(
        tx,
        engagementId,
        ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES.CANCELLED_BY_PROFESSIONAL,
      );

      // GOS-109 — DEC-008's unconditional full-refund event, inside the
      // same transaction as the CAS write above.
      await this.recordProfessionalCancellationRefundService.record(tx, {
        engagementId,
        quotedPrice,
        currency,
        customerProfileId: engagement.customerProfileId,
      });
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    this.logger.log({
      event: 'engagement_cancelled_by_professional',
      outcome: 'success',
      engagementId,
    });

    return updated!;
  }
}
