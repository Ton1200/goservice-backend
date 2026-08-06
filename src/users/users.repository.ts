import { Injectable } from '@nestjs/common';
import {
  AuthProvider,
  EmailVerificationCode,
  Prisma,
  User,
  UserAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for `User`/
 * `EmailVerificationCode` — see goservice-docs/architecture/backend.md's
 * "Data ownership within one shared database": other modules must go
 * through an explicit interface, never direct table access, to reach
 * `users`' data.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findBySocialProviderSubject(
    authProvider: AuthProvider,
    socialProviderSubject: string,
  ): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { authProvider, socialProviderSubject },
    });
  }

  createPasswordUser(
    data: Pick<
      Prisma.UserCreateInput,
      | 'firstName'
      | 'lastName'
      | 'email'
      | 'passwordHash'
      | 'phoneCountryCode'
      | 'phoneNumber'
      | 'dateOfBirth'
      | 'acceptedTermsAndPrivacy'
    >,
  ): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...data,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
    });
  }

  createSocialUser(data: {
    authProvider: AuthProvider;
    socialProviderSubject: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        authProvider: data.authProvider,
        socialProviderSubject: data.socialProviderSubject,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        // Social accounts skip the 6-digit code entirely (GOS-8's own
        // explicit proposal, adopted as the working assumption) and are
        // immediately EMAIL_VERIFIED.
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
  }

  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: UserAccountStatus.EMAIL_VERIFIED },
    });
  }

  /**
   * GOS-14/GOS-28 — the one and only place `accountStatus` moves to
   * `PENDING_APPROVAL`. Called by `ProfilesRepository.upsertCustomerProfile`
   * from within its own `$transaction`, passing that transaction's client
   * through (`tx`), so the `CustomerProfile` write and this status
   * transition commit atomically without `ProfilesRepository` ever
   * querying the `user` table directly — preserving the "one repository
   * owns one set of tables" rule documented in
   * goservice-docs/architecture/backend.md.
   *
   * The `updateMany` `WHERE accountStatus = EMAIL_VERIFIED` guard is what
   * makes "transition exactly once, never revert" race-safe: a concurrent
   * duplicate call, or any later edit after the status has already moved
   * on, always matches 0 rows and is a silent no-op — no separate
   * read-then-branch, no TOCTOU race. Returns whether the transition
   * actually happened, purely for the caller's own logging.
   */
  async transitionToPendingApprovalIfEmailVerified(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.user.updateMany({
      where: { id: userId, accountStatus: UserAccountStatus.EMAIL_VERIFIED },
      data: { accountStatus: UserAccountStatus.PENDING_APPROVAL },
    });
    return count === 1;
  }

  /**
   * Persists a new password hash for an existing user (GOS-9,
   * `resetPassword`'s successful-completion step). Callers must already
   * have hashed `newPasswordHash` via `PasswordHasherPort.hash()` — this
   * method never hashes, and never touches `accountStatus`.
   */
  updatePasswordHash(userId: string, newPasswordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });
  }

  createEmailVerificationCode(data: {
    userId: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationCode> {
    return this.prisma.emailVerificationCode.create({
      data: {
        userId: data.userId,
        codeHash: data.codeHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * The user's most recent verification code that has not been consumed or
   * invalidated — regardless of whether it has expired (callers decide how
   * to treat expiry; `resendVerificationCode`'s cooldown check, for
   * example, needs the row even once expired).
   */
  findActiveEmailVerificationCode(
    userId: string,
  ): Promise<EmailVerificationCode | null> {
    return this.prisma.emailVerificationCode.findFirst({
      where: { userId, consumedAt: null, invalidatedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  incrementAttempts(codeId: string): Promise<EmailVerificationCode> {
    return this.prisma.emailVerificationCode.update({
      where: { id: codeId },
      data: { attemptsCount: { increment: 1 } },
    });
  }

  consumeCode(codeId: string): Promise<EmailVerificationCode> {
    return this.prisma.emailVerificationCode.update({
      where: { id: codeId },
      data: { consumedAt: new Date() },
    });
  }

  invalidateCode(codeId: string): Promise<EmailVerificationCode> {
    return this.prisma.emailVerificationCode.update({
      where: { id: codeId },
      data: { invalidatedAt: new Date() },
    });
  }
}
