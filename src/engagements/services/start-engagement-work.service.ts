import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { AppointmentsRepository } from '../../appointments/appointments.repository';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementHasNoConfirmedAppointment } from '../errors/engagement-has-no-confirmed-appointment.error';
import { engagementNotAccepted } from '../errors/engagement-not-accepted.error';
import { engagementWorkStartConflict } from '../errors/engagement-work-start-conflict.error';

/**
 * Orchestrates `Mutation.startEngagementWork` (GOS-111) — the Professional
 * owner of an Engagement reports "empecé el trabajo": `ACCEPTED ->
 * IN_PROGRESS`, stamping `startedAt`.
 *
 * Shape mirrors `AcceptQuoteService`: the pre-reads (missing profile,
 * ownership, wrong state, no CONFIRMED Appointment) exist only for a good
 * specific error in the common, non-race case — the actual concurrency guard
 * is `EngagementsRepository.startWorkIfAccepted`'s guarded CAS `updateMany`
 * inside `prisma.$transaction`, whose `count !== 1` result means this call
 * lost a race (`engagementWorkStartConflict()`, full rollback).
 *
 * Ownership is checked directly against the denormalized
 * `Engagement.professionalProfileId` — a missing Engagement, a caller with no
 * `ProfessionalProfile` at all (the Customer), and a third-party Professional
 * whose profile doesn't match all collapse to the single anti-enumeration
 * code `engagementNotFound()`, exactly as `AppointmentAccessService.tryResolveParty`
 * folds them. `AppointmentAccessService` itself is NOT used: it belongs to
 * another module and also admits the Customer as a party.
 *
 * The CONFIRMED-Appointment check is pre-transaction (via
 * `AppointmentsRepository`, reused as a concrete provider — this module never
 * imports `AppointmentsModule`, and `EngagementsRepository` must never query
 * the `Appointment` table). Its tiny check -> CAS race (the Appointment gets
 * cancelled in between) is a known, accepted race of the same class as
 * `AcceptQuoteService`'s `quoteHasPendingPriceProposal` pre-check.
 */
@Injectable()
export class StartEngagementWorkService {
  private readonly logger = new Logger(StartEngagementWorkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async startEngagementWork(
    userId: string,
    engagementId: string,
  ): Promise<Engagement> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (
      !engagement ||
      !professionalProfile ||
      engagement.professionalProfileId !== professionalProfile.id
    ) {
      // Same code whether the Engagement doesn't exist, the caller has no
      // ProfessionalProfile (the Customer), or the caller is a third-party
      // Professional — anti-enumeration, same fold as
      // AppointmentAccessService.tryResolveParty.
      throw engagementNotFound();
    }

    if (engagement.status !== EngagementStatus.ACCEPTED) {
      throw engagementNotAccepted();
    }

    const confirmedAppointments =
      await this.appointmentsRepository.countConfirmedByEngagementId(
        engagementId,
      );
    if (confirmedAppointments < 1) {
      throw engagementHasNoConfirmedAppointment();
    }

    await this.prisma.$transaction(async (tx) => {
      const cas = await this.engagementsRepository.startWorkIfAccepted(
        tx,
        engagementId,
      );
      if (cas.count !== 1) {
        throw engagementWorkStartConflict();
      }
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    this.logger.log({
      event: 'engagement_work_started',
      outcome: 'success',
      engagementId,
    });
    // GOS-108 (system messages in Engagement Chat) and GOS-98 (push
    // notifications) will consume an "Engagement entered IN_PROGRESS" domain
    // event here. There is no event bus / outbox / EventEmitter in this
    // codebase yet (the CAS accept services do the same structured
    // post-commit log and nothing more); `@nestjs/event-emitter` is
    // deliberately NOT introduced by GOS-111 — out of scope.

    return updated!;
  }
}
