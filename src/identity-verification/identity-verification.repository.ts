import { Injectable } from '@nestjs/common';
import {
  CountryCode,
  IdentityDocumentType,
  IdentityVerification,
  IdentityVerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `IdentityVerification` — same data-ownership rule as `UsersRepository`/
 * `ProfilesRepository` (see goservice-docs/architecture/backend.md's "Data
 * ownership within one shared database").
 */
@Injectable()
export class IdentityVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `id` is generated APP-SIDE (`crypto.randomUUID()`, by
   * `StartIdentityVerificationService`) rather than left to Prisma's own
   * `@default(uuid())` — the id must exist BEFORE the Didit `createSession`
   * call, since it is sent to Didit as `vendor_data`. See that service's
   * own comment for the full ordering rationale.
   */
  create(data: {
    id: string;
    userId: string;
    country: CountryCode;
    provider: string;
    providerReference: string;
  }): Promise<IdentityVerification> {
    return this.prisma.identityVerification.create({ data });
  }

  findById(id: string): Promise<IdentityVerification | null> {
    return this.prisma.identityVerification.findUnique({ where: { id } });
  }

  /**
   * `myIdentityVerificationStatus`'s own read — the user's MOST RECENT
   * attempt (a user may have more than one, e.g. an earlier session was
   * Abandoned — see the model's own comment in `prisma/schema.prisma`).
   */
  findMostRecentByUserId(userId: string): Promise<IdentityVerification | null> {
    return this.prisma.identityVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Guarded update — `HandleIdentityVerificationWebhookService`'s own
   * idempotency boundary at the `IdentityVerification` level (parallel to
   * `UsersRepository.transitionFromPendingApproval`'s guard at the `User`
   * level): only ever moves a row OUT of `PENDING`, never re-decides an
   * already-decided one. A duplicate webhook delivery, or two concurrent
   * deliveries racing each other, always sees `count === 0` on every
   * delivery after the first — a safe no-op, never a second write.
   */
  async updateResultIfPending(
    id: string,
    data: {
      status: IdentityVerificationStatus;
      documentCheckPassed: boolean | null;
      biometricCheckPassed: boolean | null;
      documentType: IdentityDocumentType;
    },
  ): Promise<boolean> {
    const { count } = await this.prisma.identityVerification.updateMany({
      where: { id, status: IdentityVerificationStatus.PENDING },
      data,
    });
    return count === 1;
  }
}
