import { Injectable } from '@nestjs/common';
import { Engagement, EngagementStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `Engagement` — same data-ownership rule as `ServiceRequestsRepository`/
 * `ProfilesRepository` (see goservice-docs/architecture/backend.md).
 *
 * Writes:
 * - `create` takes an EXTERNALLY-opened `tx` — only ever called from inside
 *   `AcceptQuoteService`'s single transaction (see that service's own header
 *   comment), never on its own: an `Engagement` must never be created except
 *   atomically alongside the ServiceRequest OPEN->ENGAGED and Quote
 *   SENT->ACCEPTED CAS transitions.
 * - `startWorkIfAccepted` / `finishWorkIfInProgress` (GOS-111) /
 *   `completeIfPendingCustomerConfirmation` (GOS-113) /
 *   `cancelIfActive` (GOS-114) are the guarded compare-and-swap transitions
 *   of the work-execution state machine (ACCEPTED -> IN_PROGRESS ->
 *   PENDING_CUSTOMER_CONFIRMATION -> COMPLETED, or ACCEPTED|IN_PROGRESS ->
 *   CANCELLED).
 *   Each also takes an EXTERNALLY-opened `tx`, called only from inside its
 *   own application service's `prisma.$transaction`
 *   (`StartEngagementWorkService` / `MarkEngagementWorkFinishedService` /
 *   `ConfirmEngagementCompletionService` / `CancelEngagementByCustomerService`)
 *   — same idiom as `quotesRepository.transitionToAcceptedIfSent`. A
 *   `count !== 1` result means the caller lost a race and must throw its
 *   conflict error + roll back the transaction. `cancelIfActive` is
 *   role-agnostic by design — its `where`/`data` never reference who
 *   initiated the cancel — so GOS-117's `CancelEngagementByProfessionalService`
 *   reuses it COMPLETELY UNCHANGED as a second caller, alongside
 *   `CancelEngagementByCustomerService`.
 */
@Injectable()
export class EngagementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    tx: Prisma.TransactionClient,
    data: {
      serviceRequestId: string;
      quoteId: string;
      customerProfileId: string;
      professionalProfileId: string;
    },
  ): Promise<Engagement> {
    return tx.engagement.create({ data });
  }

  /**
   * GOS-111 — guarded CAS for `startEngagementWork`: only transitions while
   * still `ACCEPTED`. `count === 0` (no thrown error) means the Engagement
   * was no longer `ACCEPTED` when the write ran (a lost race) —
   * `StartEngagementWorkService` throws `engagementWorkStartConflict()` and
   * rolls back the surrounding `prisma.$transaction`.
   */
  startWorkIfAccepted(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ count: number }> {
    return tx.engagement.updateMany({
      where: { id, status: EngagementStatus.ACCEPTED },
      data: { status: EngagementStatus.IN_PROGRESS, startedAt: new Date() },
    });
  }

  /**
   * GOS-111 — guarded CAS for `markEngagementWorkFinished`: only transitions
   * while still `IN_PROGRESS`. `count === 0` means a lost race —
   * `MarkEngagementWorkFinishedService` throws
   * `engagementWorkFinishConflict()` and rolls back.
   */
  finishWorkIfInProgress(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ count: number }> {
    return tx.engagement.updateMany({
      where: { id, status: EngagementStatus.IN_PROGRESS },
      data: {
        status: EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
        finishedAt: new Date(),
      },
    });
  }

  /**
   * GOS-113 — guarded CAS for `confirmEngagementCompletion`: only
   * transitions while still `PENDING_CUSTOMER_CONFIRMATION`. `count === 0`
   * means a lost race — `ConfirmEngagementCompletionService` throws
   * `engagementCompletionConflict()` and rolls back. GOS-121 — stamps
   * `completedAt` in the SAME write (added retroactively; GOS-113 shipped
   * without it — see `Engagement.completedAt`'s own comment in
   * `prisma/schema.prisma`), same "stamp in the same write" criterion
   * `cancelIfActive` already uses for `cancelledAt`/`cancelReason`.
   */
  completeIfPendingCustomerConfirmation(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ count: number }> {
    return tx.engagement.updateMany({
      where: { id, status: EngagementStatus.PENDING_CUSTOMER_CONFIRMATION },
      data: { status: EngagementStatus.COMPLETED, completedAt: new Date() },
    });
  }

  /**
   * GOS-114 — guarded CAS for `cancelEngagementByCustomer`: only
   * transitions while still `ACCEPTED` or `IN_PROGRESS` (unlike the other
   * three CAS methods above, this one guards TWO source statuses in a
   * single `updateMany`, same idiom as `AppointmentsRepository.cancelIfActive`).
   * `count === 0` means a lost race (e.g. the Professional's own
   * `startEngagementWork`/`markEngagementWorkFinished`, or a second
   * concurrent cancel, ran in between the caller's pre-read and this write)
   * — `CancelEngagementByCustomerService` throws `engagementCancelConflict()`
   * and rolls back. Stamps `cancelledAt`/`cancelReason` in the same write —
   * no separate column-only update.
   */
  cancelIfActive(
    tx: Prisma.TransactionClient,
    id: string,
    cancelReason: string,
  ): Promise<{ count: number }> {
    return tx.engagement.updateMany({
      where: {
        id,
        status: {
          in: [EngagementStatus.ACCEPTED, EngagementStatus.IN_PROGRESS],
        },
      },
      data: {
        status: EngagementStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason,
      },
    });
  }

  /**
   * GOS-46 — Engagement Chat's own party-resolution lookup
   * (`EngagementChatAccessService.resolveParty`) needs to look an
   * `Engagement` up by its OWN id (the `engagementId` GraphQL argument),
   * unlike the two ID-of-a-different-entity lookups below. Reused as a
   * concrete provider directly (this class is already `exports`-ed from
   * `EngagementsModule` for exactly this "future Chat/Notifications module"
   * reuse — see this class's own header comment and
   * `EngagementsModule`'s).
   */
  findById(id: string): Promise<Engagement | null> {
    return this.prisma.engagement.findUnique({ where: { id } });
  }

  findByServiceRequestId(serviceRequestId: string): Promise<Engagement | null> {
    return this.prisma.engagement.findUnique({ where: { serviceRequestId } });
  }

  findByQuoteId(quoteId: string): Promise<Engagement | null> {
    return this.prisma.engagement.findUnique({ where: { quoteId } });
  }

  findManyByCustomerProfileId(
    customerProfileId: string,
  ): Promise<Engagement[]> {
    return this.prisma.engagement.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findManyByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<Engagement[]> {
    return this.prisma.engagement.findMany({
      where: { professionalProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
