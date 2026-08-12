import { Injectable } from '@nestjs/common';
import { AdminSession, AdminSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `AdminSession` — same data-ownership rule as `src/auth/sessions.repository.ts`
 * applied to its admin counterpart. Never exported outside
 * `PlatformAdminModule`.
 */
@Injectable()
export class AdminSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    adminUserId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AdminSession> {
    return this.prisma.adminSession.create({
      data: {
        adminUserId: data.adminUserId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  findByTokenHash(tokenHash: string): Promise<AdminSession | null> {
    return this.prisma.adminSession.findUnique({ where: { tokenHash } });
  }

  markExpired(id: string): Promise<AdminSession> {
    return this.prisma.adminSession.update({
      where: { id },
      data: { status: AdminSessionStatus.EXPIRED },
    });
  }

  markRevoked(id: string): Promise<AdminSession> {
    return this.prisma.adminSession.update({
      where: { id },
      data: { status: AdminSessionStatus.REVOKED, revokedAt: new Date() },
    });
  }
}
