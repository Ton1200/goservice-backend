import { Injectable, Logger } from '@nestjs/common';
import { Engagement, EngagementStatus } from '@prisma/client';
import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { EngagementsRepository } from '../engagements.repository';
import { engagementCompletionConflict } from '../errors/engagement-completion-conflict.error';
import { engagementNotPendingCustomerConfirmation } from '../errors/engagement-not-pending-customer-confirmation.error';

/**
 * Orchestrates `Mutation.confirmEngagementCompletion` (GOS-113) — the
 * Customer owner of an Engagement confirms the work really got done:
 * `PENDING_CUSTOMER_CONFIRMATION -> COMPLETED`. The Customer-side
 * counterpart of GOS-111's `MarkEngagementWorkFinishedService`: same shape,
 * swapping `findProfessionalProfileByUserId`/`professionalProfileId` for
 * `findCustomerProfileByUserId`/`customerProfileId`.
 *
 * Same ownership discipline as the GOS-111 services (missing Engagement /
 * no `CustomerProfile` at all — the Professional — / third party all
 * collapse to `engagementNotFound()`). The only checks are ownership +
 * `status === PENDING_CUSTOMER_CONFIRMATION` (pre-read,
 * `engagementNotPendingCustomerConfirmation()`) + the guarded CAS
 * (`engagementCompletionConflict()` on a lost race, full rollback) — no
 * re-gate on anything else (e.g. no re-check of `finishedAt` age).
 */
@Injectable()
export class ConfirmEngagementCompletionService {
  private readonly logger = new Logger(ConfirmEngagementCompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async confirmEngagementCompletion(
    userId: string,
    engagementId: string,
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

    if (engagement.status !== EngagementStatus.PENDING_CUSTOMER_CONFIRMATION) {
      throw engagementNotPendingCustomerConfirmation();
    }

    await this.prisma.$transaction(async (tx) => {
      const cas =
        await this.engagementsRepository.completeIfPendingCustomerConfirmation(
          tx,
          engagementId,
        );
      if (cas.count !== 1) {
        throw engagementCompletionConflict();
      }
    });

    const updated = await this.engagementsRepository.findById(engagementId);

    this.logger.log({
      event: 'engagement_completed',
      outcome: 'success',
      engagementId,
    });
    // GOS-106 (enabling ratings), GOS-107 (Engagement Chat close
    // orchestration), and GOS-109 (making the commission firm) will consume
    // an "Engagement COMPLETED" domain event here. There is no event bus /
    // outbox / EventEmitter in this codebase yet (the CAS accept/work
    // services do the same structured post-commit log and nothing more);
    // `@nestjs/event-emitter` is deliberately NOT introduced by GOS-113 —
    // out of scope.

    return updated!;
  }
}
