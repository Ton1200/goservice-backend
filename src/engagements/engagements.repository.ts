import { Injectable } from '@nestjs/common';
import { Engagement, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `Engagement` — same data-ownership rule as `ServiceRequestsRepository`/
 * `ProfilesRepository` (see goservice-docs/architecture/backend.md).
 *
 * `create` is deliberately the only write, and it deliberately takes an
 * EXTERNALLY-opened `tx` — it is only ever called from inside
 * `AcceptQuoteService`'s single transaction (see that service's own header
 * comment), never on its own: an `Engagement` must never be created except
 * atomically alongside the ServiceRequest OPEN->ENGAGED and Quote
 * SENT->ACCEPTED CAS transitions.
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
