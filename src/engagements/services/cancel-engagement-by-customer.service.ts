import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES } from '../../engagement-chat/constants/engagement-lifecycle-system-messages.constants';
import { EmitEngagementLifecycleSystemMessageService } from '../../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementCancelConflict } from '../errors/engagement-cancel-conflict.error';
import { engagementNotCancellableByCustomer } from '../errors/engagement-not-cancellable-by-customer.error';

/**
 * Orchestrates `Mutation.cancelEngagementByCustomer` (GOS-114) — the
 * Customer owner of a still-open Engagement (`ACCEPTED` or `IN_PROGRESS`)
 * cancels it, recording a required `reason`: -> `CANCELLED`, stamping
 * `cancelledAt`/`cancelReason`. Same shape as
 * `ConfirmEngagementCompletionService`/`StartEngagementWorkService`: the
 * pre-reads (missing profile, ownership, wrong state) exist only for a good
 * specific error in the common, non-race case — the actual concurrency
 * guard is `EngagementsRepository.cancelIfActive`'s guarded CAS `updateMany`
 * inside `prisma.$transaction`, whose `count !== 1` result means this call
 * lost a race (`engagementCancelConflict()`, full rollback).
 *
 * Ownership is checked directly against the denormalized
 * `Engagement.customerProfileId` — a missing Engagement, a caller with no
 * `CustomerProfile` at all (the Professional), and an unrelated third-party
 * Customer all collapse to the single anti-enumeration code
 * `engagementNotFound()`, reused unchanged from GOS-111/113/46.
 *
 * Deliberately ONE precheck error (`engagementNotCancellableByCustomer()`)
 * for all three disallowed states (`PENDING_CUSTOMER_CONFIRMATION`,
 * `COMPLETED`, already-`CANCELLED`) — not split per-state, per this ticket's
 * own AC.
 *
 * Does NOT touch `src/engagement-chat/` — closing the coordination
 * conversation is GOS-107, out of scope here. Does NOT compute or move any
 * money — see `computeCustomerCancellationCharge` below.
 */
@Injectable()
export class CancelEngagementByCustomerService {
  private readonly logger = new Logger(CancelEngagementByCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly emitEngagementLifecycleSystemMessageService: EmitEngagementLifecycleSystemMessageService,
  ) {}

  async cancelEngagementByCustomer(
    userId: string,
    engagementId: string,
    reason: string,
  ): Promise<Engagement> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (
      !engagement ||
      !customerProfile ||
      engagement.customerProfileId !== customerProfile.id
    ) {
      // Anti-enumeration — same code for "doesn't exist", "caller has no
      // CustomerProfile" (the Professional), and "not yours".
      throw engagementNotFound();
    }

    if (
      engagement.status !== EngagementStatus.ACCEPTED &&
      engagement.status !== EngagementStatus.IN_PROGRESS
    ) {
      throw engagementNotCancellableByCustomer();
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

      // GOS-125 — emits the "Trabajo cancelado por el cliente" system chat
      // message inside this SAME transaction — see
      // `StartEngagementWorkService`'s identical note.
      await this.emitEngagementLifecycleSystemMessageService.emit(
        tx,
        engagementId,
        ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES.CANCELLED_BY_CUSTOMER,
      );
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    // GOS-109 extension point: customer-initiated cancellation may one day
    // trigger a charge/refund calculation (e.g. a cancellation fee if the
    // Professional had already started work). No such trigger or
    // calculation exists yet — there is no payments/commission/ledger table
    // anywhere in this schema, so there is nothing for this method to read,
    // write, or even meaningfully simulate. This call exists purely as the
    // documented, exercised (not dead-code) seam GOS-109 will replace; its
    // `null` return is deliberately not surfaced on any GraphQL field.
    this.computeCustomerCancellationCharge(updated!);

    this.logger.log({
      event: 'engagement_cancelled_by_customer',
      outcome: 'success',
      engagementId,
    });

    return updated!;
  }

  /**
   * GOS-109 extension point — see the call-site comment above. Always
   * returns `null` today; reserved for a future customer-cancellation
   * charge/refund calculation once a payments/commission ledger exists.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private computeCustomerCancellationCharge(engagement: Engagement): null {
    return null;
  }
}
