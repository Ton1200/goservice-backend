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
 * The exact set of `User` columns the platform-admin `userAccounts`/
 * `updateUserAccount`/`forceUserAccountPasswordReset` capability
 * (`src/platform-admin/user-accounts/`) is ever allowed to read —
 * DELIBERATELY excludes `passwordHash`/`socialProviderSubject`. This is a
 * structural guardrail, not just "the GraphQL type omits those fields": the
 * fields are never even selected out of Postgres for this capability, the
 * same defense-in-depth principle `PlatformSettingModel`'s
 * `rawValue`/`rawMaskedPreview` split already uses for encrypted settings —
 * see that model's own header comment in
 * `src/platform-admin/platform-settings/models/platform-setting.model.ts`.
 * `customerProfile`/`professionalProfile` are included ONLY as a presence
 * check (`{ select: { id: true } }`) — never any profile-specific field —
 * so `AdminUserAccountRow.customerProfile !== null`/`professionalProfile
 * !== null` can derive `hasCustomerProfile`/`hasProfessionalProfile`
 * without a second round trip.
 */
const ADMIN_USER_ACCOUNT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneCountryCode: true,
  phoneNumber: true,
  accountStatus: true,
  authProvider: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: { select: { id: true } },
  professionalProfile: { select: { id: true } },
} satisfies Prisma.UserSelect;

export type AdminUserAccountRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_ACCOUNT_SELECT;
}>;

/**
 * The richer select `userAccountDetail` (`src/platform-admin/user-accounts/`)
 * uses for ONE user at a time — deliberately NOT used by
 * `findManyForAdmin`/`ADMIN_USER_ACCOUNT_SELECT` above, which stays a cheap
 * presence-only select because it can return up to 200 rows per call (see
 * `ListUserAccountsService`). Same structural guardrail as
 * `ADMIN_USER_ACCOUNT_SELECT`: `passwordHash`/`socialProviderSubject` are
 * still never selected — only the base identity columns, listed out
 * explicitly (not `customerProfile`/`professionalProfile: true` shorthand at
 * the TOP level, since that would still be fine, but being explicit here
 * keeps this select trivially diffable against `ADMIN_USER_ACCOUNT_SELECT`
 * above). `customerProfile`/`professionalProfile` are each expanded to their
 * FULL row (not just `{ id: true }` presence checks) — `professionalProfile`
 * additionally nests its full `specializations` set (with each one's
 * `category`), ordered the same way `ProfilesRepository`'s own
 * `findProfessionalProfileByUserId` orders them. This crosses into
 * `CustomerProfile`/`ProfessionalProfile`/`ProfessionalSpecialization`/
 * `Category` — tables `ProfilesRepository` otherwise calls "the ONLY place
 * in this codebase that issues Prisma queries for" — but that claim has
 * always been about a SEPARATE, competing repository, not about
 * `UsersRepository` reading these relations off of `User` itself: this same
 * class already did that (as presence-only booleans) via
 * `ADMIN_USER_ACCOUNT_SELECT` above before this method ever existed, and
 * that established, human-approved precedent (see this class's own header
 * comment on `userAccounts`) is what this method extends, not a new
 * exception.
 */
const ADMIN_USER_ACCOUNT_DETAIL_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneCountryCode: true,
  phoneNumber: true,
  accountStatus: true,
  authProvider: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: true,
  professionalProfile: {
    include: {
      specializations: {
        include: { category: true },
        orderBy: { order: 'asc' },
      },
    },
  },
} satisfies Prisma.UserSelect;

export type AdminUserAccountDetailRow = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_ACCOUNT_DETAIL_SELECT;
}>;

/**
 * The ONLY place in this codebase that issues Prisma queries for `User`/
 * `EmailVerificationCode` — see goservice-docs/architecture/backend.md's
 * "Data ownership within one shared database": other modules must go
 * through an explicit interface, never direct table access, to reach
 * `users`' data. This includes the platform-admin `userAccounts` capability
 * (GOS-3x follow-up, 2026-08-10) — a documented, human-approved EXCEPTION to
 * platform-admin's usual isolation from consumer domain tables (see
 * `goservice-docs/architecture/domain-model.md`), but still routed through
 * THIS repository, never a second, competing repository querying `user`
 * directly. `PlatformAdminModule` reuses this CLASS directly as a provider
 * (mirroring the `Argon2PasswordHasherAdapter` precedent — see that
 * module's own header comment) rather than importing the resolver-bearing
 * `UsersModule`.
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

  /**
   * `myAccount`'s (consumer, `ProfilesResolver`) narrow read — a minimal
   * `select: { accountStatus: true }`, same "select exactly the columns the
   * caller needs, nothing more" discipline as `ADMIN_USER_ACCOUNT_SELECT`
   * above, just scoped to a single field for a single-field caller. Returns
   * `null` only if `userId` doesn't resolve to a `User` row at all — should
   * never happen for an already-`SessionGuard`-authenticated caller, but
   * kept nullable rather than assumed, same defensive shape as `findById`.
   */
  async findAccountStatusById(
    userId: string,
  ): Promise<UserAccountStatus | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });
    return user?.accountStatus ?? null;
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
   * `PENDING_APPROVAL`. Called by BOTH
   * `ProfilesRepository.upsertCustomerProfile` AND
   * `ProfilesRepository.upsertProfessionalProfile`, whichever profile type
   * is created first for a given user, from within that method's own
   * `$transaction`, passing that transaction's client through (`tx`), so
   * the profile write and this status transition commit atomically without
   * `ProfilesRepository` ever querying the `user` table directly —
   * preserving the "one repository owns one set of tables" rule documented
   * in goservice-docs/architecture/backend.md.
   *
   * The `updateMany` `WHERE accountStatus = EMAIL_VERIFIED` guard is what
   * makes "transition exactly once, never revert" race-safe: a concurrent
   * duplicate call, or any later edit after the status has already moved
   * on (including the SECOND profile type being created for the same
   * user), always matches 0 rows and is a silent no-op — no separate
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
   * Identity Verification's own `accountStatus` transition — the SECOND way
   * (alongside the pre-existing manual `updateForAdmin`/`updateUserAccount`
   * path) `PENDING_APPROVAL` can move to `APPROVED`/`REJECTED`, this one
   * driven automatically by `HandleIdentityVerificationWebhookService` when
   * a Didit webhook reports a final decision. Same guarded-`updateMany`
   * race-safety pattern as
   * `transitionToPendingApprovalIfEmailVerified` above: the `WHERE
   * accountStatus = PENDING_APPROVAL` guard makes this idempotent against a
   * duplicate webhook delivery (second call always matches 0 rows, a safe
   * no-op) AND makes it never overwrite a decision the admin manual path
   * already made (if `updateForAdmin` already moved the account to
   * `APPROVED`/`REJECTED`, this guard also matches 0 rows) — no separate
   * read-then-branch, no TOCTOU race. Returns whether the transition
   * actually happened, purely for the caller's own logging.
   */
  async transitionFromPendingApproval(
    userId: string,
    to: Extract<UserAccountStatus, 'APPROVED' | 'REJECTED'>,
  ): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, accountStatus: UserAccountStatus.PENDING_APPROVAL },
      data: { accountStatus: to },
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

  // ---- platform-admin `userAccounts` capability (GOS-3x follow-up) -------
  // Every read/write method below uses `ADMIN_USER_ACCOUNT_SELECT` — never
  // the bare `User` model — so `passwordHash`/`socialProviderSubject` are
  // structurally impossible to leak through this path. Phase-1 scope:
  // `findManyForAdmin` supports pagination only (`limit`/`offset`) — no
  // server-side filter/sort arguments yet; the admin panel's grid does its
  // own client-side filtering/sorting on the fetched page (see
  // `ListUserAccountsService`'s own comment for the full rationale).
  // `deleteForAdmin` (hard-delete, 2026-08-11) is the one exception —
  // `tx.user.delete()` returns the bare deleted row, but its caller
  // (`DeleteUserAccountService`) never reads or forwards that return value.

  findManyForAdmin(params: {
    limit: number;
    offset: number;
  }): Promise<AdminUserAccountRow[]> {
    return this.prisma.user.findMany({
      select: ADMIN_USER_ACCOUNT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  countAllForAdmin(): Promise<number> {
    return this.prisma.user.count();
  }

  findByIdForAdmin(id: string): Promise<AdminUserAccountRow | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_USER_ACCOUNT_SELECT,
    });
  }

  /**
   * `userAccountDetail`'s (GOS-3x follow-up) one-user-at-a-time read — see
   * `ADMIN_USER_ACCOUNT_DETAIL_SELECT`'s own header comment for why this is
   * a deliberately separate, richer select from `findByIdForAdmin` above,
   * never used for the paginated grid.
   */
  findByIdForAdminWithProfiles(
    id: string,
  ): Promise<AdminUserAccountDetailRow | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: ADMIN_USER_ACCOUNT_DETAIL_SELECT,
    });
  }

  /**
   * Runs inside the caller's own `$transaction` (`UpdateUserAccountService`)
   * — same pattern as `PlatformSettingsRepository.upsert`: the `User`
   * update and the `AdminAuditLog` write commit atomically or not at all.
   */
  updateForAdmin(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.UserUpdateInput,
  ): Promise<AdminUserAccountRow> {
    return tx.user.update({
      where: { id },
      data,
      select: ADMIN_USER_ACCOUNT_SELECT,
    });
  }

  /**
   * GOS-3x follow-up (hard-delete, 2026-08-11) — `DeleteUserAccountService`'s
   * actual erasure step, run inside its own `$transaction` AFTER the
   * `AdminAuditLog` snapshot row has already been written on the same `tx`
   * (the audit row must exist BEFORE the `User` row it references by
   * `targetKey` disappears — `targetKey` is a plain `String`, not a FK, so
   * the audit trail survives intact afterward). Every `Session`/
   * `EmailVerificationCode`/`PasswordResetCode`/`CustomerProfile`/
   * `ProfessionalProfile` (→ `ProfessionalSpecialization`) this user owns is
   * removed automatically by Postgres via each relation's own
   * `onDelete: Cascade` — no application-level cleanup needed here.
   */
  deleteForAdmin(tx: Prisma.TransactionClient, id: string): Promise<User> {
    return tx.user.delete({ where: { id } });
  }
}
