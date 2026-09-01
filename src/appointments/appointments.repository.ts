import { Injectable } from '@nestjs/common';
import { Appointment, AppointmentParty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { appointmentConflict } from './errors/appointment-conflict.error';
import { isAppointmentExclusionViolation } from './is-appointment-exclusion-violation.util';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `Appointment` — same data-ownership rule as
 * `EngagementChatRepository`/`QuoteNegotiationRepository` (see
 * goservice-docs/architecture/backend.md).
 *
 * Every write here touches exactly one table — unlike `AcceptQuoteService`'s
 * multi-table reason for owning `prisma.$transaction`, no method here needs
 * one: each write is a single guarded call directly on `this.prisma`.
 */
@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    engagementId: string;
    professionalProfileId: string;
    startsAt: Date;
    endsAt: Date;
    proposedByRole: AppointmentParty;
    proposedByCustomerProfileId: string | null;
    proposedByProfessionalProfileId: string | null;
  }): Promise<Appointment> {
    return this.prisma.appointment.create({ data });
  }

  findById(id: string): Promise<Appointment | null> {
    return this.prisma.appointment.findUnique({ where: { id } });
  }

  findManyByEngagementId(engagementId: string): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `AcceptAppointmentService`'s CAS — only actually confirms while still
   * `PENDING`. `count === 0` (with no thrown error) covers "already
   * confirmed/cancelled by a concurrent request" (`APPOINTMENT_ACCEPT_CONFLICT`,
   * thrown by the caller) — same idiom as
   * `QuoteNegotiationRepository.acceptProposal`.
   *
   * Separately, this same `updateMany` can hit the REAL DB-level guarantee
   * — the `appointment_no_overlapping_confirmed_per_professional` `EXCLUDE`
   * constraint (see the migration) — when the requested time genuinely
   * overlaps a DIFFERENT already-`CONFIRMED` Appointment for the same
   * professional. That raises a raw Postgres SQLSTATE 23P01
   * (`exclusion_violation`), which Prisma surfaces as a
   * `Prisma.PrismaClientUnknownRequestError` (empirically confirmed — see
   * `is-appointment-exclusion-violation.util.ts`'s own header comment for
   * the full probe write-up) — caught here and translated into the
   * AC-mandated `appointmentConflict()` domain error, never a raw/technical
   * error reaching the GraphQL client.
   */
  async confirmIfPending(id: string): Promise<{ count: number }> {
    try {
      return await this.prisma.appointment.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
    } catch (error: unknown) {
      if (isAppointmentExclusionViolation(error)) {
        throw appointmentConflict();
      }
      throw error;
    }
  }

  /**
   * `CancelAppointmentService`'s CAS — only actually cancels while
   * `PENDING` or `CONFIRMED` (i.e. not already `CANCELLED`). `count === 0`
   * covers "already cancelled by a concurrent request"
   * (`APPOINTMENT_CANCEL_CONFLICT`, thrown by the caller). Never touches the
   * `EXCLUDE` constraint (a row leaving `CONFIRMED` can only ever FREE UP a
   * slot, never conflict with one), so no exclusion-violation handling is
   * needed here.
   */
  cancelIfActive(id: string, cancelReason: string): Promise<{ count: number }> {
    return this.prisma.appointment.updateMany({
      where: { id, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason },
    });
  }
}
