import { Injectable } from '@nestjs/common';
import { PasswordResetCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `PasswordResetCode` — mirrors `users/users.repository.ts`'s role for
 * `EmailVerificationCode` (see
 * goservice-docs/architecture/backend.md's "Data ownership within one
 * shared database"). Never exported outside `PasswordResetModule`. `User`
 * itself is never queried/written here — that stays owned by
 * `UsersRepository` (`users.findByEmail`, `users.updatePasswordHash`).
 */
@Injectable()
export class PasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPasswordResetCode(data: {
    userId: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetCode> {
    return this.prisma.passwordResetCode.create({
      data: {
        userId: data.userId,
        codeHash: data.codeHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * The user's most recent password-reset code that has not been consumed
   * or invalidated — regardless of whether it has expired (callers decide
   * how to treat expiry; the cooldown check in
   * `RequestPasswordResetService`, for example, needs the row even once
   * expired).
   */
  findActivePasswordResetCode(
    userId: string,
  ): Promise<PasswordResetCode | null> {
    return this.prisma.passwordResetCode.findFirst({
      where: { userId, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  incrementAttempts(codeId: string): Promise<PasswordResetCode> {
    return this.prisma.passwordResetCode.update({
      where: { id: codeId },
      data: { attemptsCount: { increment: 1 } },
    });
  }

  consumeCode(codeId: string): Promise<PasswordResetCode> {
    return this.prisma.passwordResetCode.update({
      where: { id: codeId },
      data: { consumedAt: new Date() },
    });
  }

  invalidateCode(codeId: string): Promise<PasswordResetCode> {
    return this.prisma.passwordResetCode.update({
      where: { id: codeId },
      data: { invalidatedAt: new Date() },
    });
  }

  /**
   * Invalidates every remaining active code for `userId` other than
   * `keepCodeId` — used by `ResetPasswordService`'s "defense in depth"
   * step (§6, step 9 of the GOS-9 plan) after the matching code has
   * already been consumed, in case more than one active row somehow
   * exists.
   */
  async invalidateOtherActiveCodes(
    userId: string,
    keepCodeId: string,
  ): Promise<void> {
    await this.prisma.passwordResetCode.updateMany({
      where: {
        userId,
        consumedAt: null,
        invalidatedAt: null,
        id: { not: keepCodeId },
      },
      data: { invalidatedAt: new Date() },
    });
  }
}
