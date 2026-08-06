import { Injectable } from '@nestjs/common';
import { Session, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `Session` — mirrors `users/users.repository.ts`'s role for `User`/
 * `EmailVerificationCode` (see goservice-docs/architecture/backend.md's
 * "Data ownership within one shared database"). Never exported outside
 * `AuthModule`.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { tokenHash } });
  }

  markExpired(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.EXPIRED },
    });
  }

  markRevoked(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
  }

  /**
   * Bulk counterpart to `markRevoked` (GOS-9) — revokes every `ACTIVE`
   * session for `userId` in one statement rather than one row at a time.
   * Returns the number of rows actually updated.
   */
  async revokeAllActiveForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
    });
    return result.count;
  }
}
