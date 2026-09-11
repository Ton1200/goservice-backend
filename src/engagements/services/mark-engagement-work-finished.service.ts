import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementNotInProgress } from '../errors/engagement-not-in-progress.error';
import { engagementWorkFinishConflict } from '../errors/engagement-work-finish-conflict.error';

/**
 * Orchestrates `Mutation.markEngagementWorkFinished` (GOS-111) — the
 * Professional owner reports "terminé, falta que el Cliente confirme":
 * `IN_PROGRESS -> PENDING_CUSTOMER_CONFIRMATION`, stamping `finishedAt`.
 *
 * Same shape and ownership discipline as `StartEngagementWorkService`
 * (missing Engagement / no `ProfessionalProfile` / third party all collapse
 * to `engagementNotFound()`), minus the CONFIRMED-Appointment gate: to be
 * `IN_PROGRESS` the Engagement already passed that gate in
 * `startEngagementWork`, and an Appointment cancelled afterwards is
 * GOS-113/114/117's concern, not this transition's. The only checks are
 * ownership + `status === IN_PROGRESS` (pre-read, `engagementNotInProgress()`)
 * + the guarded CAS (`engagementWorkFinishConflict()` on a lost race, full
 * rollback).
 */
@Injectable()
export class MarkEngagementWorkFinishedService {
  private readonly logger = new Logger(MarkEngagementWorkFinishedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async markEngagementWorkFinished(
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
      // Anti-enumeration — same code for "doesn't exist", "caller has no
      // ProfessionalProfile" (the Customer), and "not yours".
      throw engagementNotFound();
    }

    if (engagement.status !== EngagementStatus.IN_PROGRESS) {
      throw engagementNotInProgress();
    }

    await this.prisma.$transaction(async (tx) => {
      const cas = await this.engagementsRepository.finishWorkIfInProgress(
        tx,
        engagementId,
      );
      if (cas.count !== 1) {
        throw engagementWorkFinishConflict();
      }
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    this.logger.log({
      event: 'engagement_work_finished',
      outcome: 'success',
      engagementId,
    });
    // GOS-108 (system messages in Engagement Chat) and GOS-98 (push
    // notifications) will consume an "Engagement entered
    // PENDING_CUSTOMER_CONFIRMATION" domain event here — see
    // `StartEngagementWorkService`'s identical note. No event bus exists yet;
    // `@nestjs/event-emitter` is deliberately NOT introduced by GOS-111.

    return updated!;
  }
}
