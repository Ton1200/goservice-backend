import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES } from '../../engagement-chat/constants/engagement-lifecycle-system-messages.constants';
import { EmitEngagementLifecycleSystemMessageService } from '../../engagement-chat/services/emit-engagement-lifecycle-system-message.service';
import { CURRENCY_BY_COUNTRY } from '../../ledger/constants/country-currency.constants';
import { RecordCustomerCancellationChargeService } from '../../ledger/services/record-customer-cancellation-charge.service';
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
 * conversation is GOS-107, out of scope here.
 *
 * **GOS-109**: the pre-cancel ownership/state read now uses
 * `EngagementsRepository.findByIdWithBillingContext` (NOT the plain
 * `findById` used for the final re-read below) — the pre-cancel `status`/
 * accepted-`Quote` price/owning `CustomerProfile.country` are only visible
 * BEFORE `cancelIfActive`'s CAS write flips `status` to `CANCELLED`, and
 * must be captured before the transaction opens. Inside the SAME
 * `prisma.$transaction` as the CAS write, immediately after
 * `emitEngagementLifecycleSystemMessageService.emit`,
 * `recordCustomerCancellationChargeService.recordIfApplicable` writes the
 * DEC-008 cancellation-charge ledger event (a no-op while `ACCEPTED`, 3
 * `LedgerEntry` rows while `IN_PROGRESS`) — a ledger-write failure rolls
 * back the whole cancellation, same guarantee `emit` already has.
 */
@Injectable()
export class CancelEngagementByCustomerService {
  private readonly logger = new Logger(CancelEngagementByCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly emitEngagementLifecycleSystemMessageService: EmitEngagementLifecycleSystemMessageService,
    private readonly recordCustomerCancellationChargeService: RecordCustomerCancellationChargeService,
  ) {}

  async cancelEngagementByCustomer(
    userId: string,
    engagementId: string,
    reason: string,
  ): Promise<Engagement> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    const engagement =
      await this.engagementsRepository.findByIdWithBillingContext(engagementId);
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

    const preCancelStatus = engagement.status;
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

      // GOS-125 — emits the "Trabajo cancelado por el cliente" system chat
      // message inside this SAME transaction — see
      // `StartEngagementWorkService`'s identical note.
      await this.emitEngagementLifecycleSystemMessageService.emit(
        tx,
        engagementId,
        ENGAGEMENT_LIFECYCLE_SYSTEM_MESSAGES.CANCELLED_BY_CUSTOMER,
      );

      // GOS-109 — DEC-008's cancellation-charge event, inside the same
      // transaction as the CAS write above.
      await this.recordCustomerCancellationChargeService.recordIfApplicable(
        tx,
        {
          engagementId,
          preCancelStatus,
          quotedPrice,
          currency,
          customerProfileId: engagement.customerProfileId,
          professionalProfileId: engagement.professionalProfileId,
        },
      );
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    this.logger.log({
      event: 'engagement_cancelled_by_customer',
      outcome: 'success',
      engagementId,
    });

    return updated!;
  }
}
