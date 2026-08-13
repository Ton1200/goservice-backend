import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { BulkDeleteUserAccountsPayload } from './models/bulk-delete-user-accounts-payload.model';
import { DeleteUserAccountPayload } from './models/delete-user-account-payload.model';
import { ForceUserAccountPasswordResetPayload } from './models/force-user-account-password-reset-payload.model';
import { UpdateUserAccountInput } from './models/update-user-account.input';
import { UserAccountDetailModel } from './models/user-account-detail.model';
import { UserAccountModel } from './models/user-account.model';
import { UserAccountsPageModel } from './models/user-accounts-page.model';
import { BulkDeleteUserAccountsService } from './services/bulk-delete-user-accounts.service';
import { DeleteUserAccountService } from './services/delete-user-account.service';
import { ForceUserAccountPasswordResetService } from './services/force-user-account-password-reset.service';
import { GetUserAccountDetailService } from './services/get-user-account-detail.service';
import { ListUserAccountsService } from './services/list-user-accounts.service';
import { UpdateUserAccountService } from './services/update-user-account.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `userAccounts` (read) requires `USER_ACCOUNTS_READ`; `updateUserAccount`/
 * `forceUserAccountPasswordReset` (write) require `USER_ACCOUNTS_WRITE`.
 *
 * NAMING NOTE: this is about GoService's own consumer end users (customers/
 * professionals) — `userAccounts`/`UserAccount`/`updateUserAccount`, never
 * "adminUsers"/"AdminUsers" (that name is reserved for a DIFFERENT,
 * not-yet-built future capability: admin-to-admin invite management). See
 * ADR 0005's dedicated section on this feature for the full disambiguation.
 *
 * `deleteUserAccount`/`bulkDeleteUserAccounts` (GOS-3x follow-up, hard-delete,
 * 2026-08-11 — REPLACES the prior round's reversible
 * `deactivateUserAccount`/`reactivateUserAccount`/`bulkDeactivateUserAccounts`
 * soft-delete entirely, at explicit human authorization; see ADR 0005's
 * Tenth round) require `USER_ACCOUNTS_DELETE` — a SEPARATE, higher-bar
 * permission from `USER_ACCOUNTS_WRITE` (granted to `SUPER_ADMIN` only —
 * see `scripts/bootstrap-super-admin.ts`), deliberately NOT folded into
 * `USER_ACCOUNTS_WRITE`: permanently erasing a real consumer account is far
 * more consequential than editing a field.
 *
 * `userAccountDetail` (GOS-3x follow-up, "View" row action) is gated by the
 * SAME `USER_ACCOUNTS_READ` as `userAccounts` — a read-only detail view over
 * one user, no new permission needed. See `UserAccountDetailModel`'s own
 * header comment for why it is a deliberately separate GraphQL type from
 * `UserAccountModel`, not a superset reused in its place.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class UserAccountsResolver {
  constructor(
    private readonly listUserAccountsService: ListUserAccountsService,
    private readonly updateUserAccountService: UpdateUserAccountService,
    private readonly forceUserAccountPasswordResetService: ForceUserAccountPasswordResetService,
    private readonly deleteUserAccountService: DeleteUserAccountService,
    private readonly bulkDeleteUserAccountsService: BulkDeleteUserAccountsService,
    private readonly getUserAccountDetailService: GetUserAccountDetailService,
  ) {}

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_READ)
  @Query(() => UserAccountsPageModel, {
    description:
      'Lists GoService consumer user accounts (customers/professionals), paginated. Phase-1 scope: limit/offset only, no server-side filter/sort arguments yet — the admin panel does client-side filtering/sorting on the fetched page.',
  })
  userAccounts(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<UserAccountsPageModel> {
    return this.listUserAccountsService.listUserAccounts(limit, offset);
  }

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_READ)
  @Query(() => UserAccountDetailModel, {
    description:
      'Full detail view of one consumer user account, including its CustomerProfile/ProfessionalProfile if present (null if the user never created one). Same USER_ACCOUNTS_READ permission as userAccounts — no separate permission for this detail view.',
  })
  userAccountDetail(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<UserAccountDetailModel> {
    return this.getUserAccountDetailService.getUserAccountDetail(id);
  }

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_WRITE)
  @Mutation(() => UserAccountModel, {
    description:
      'Partially updates a consumer user account (only the fields present in the input are changed) and writes an AdminAuditLog row in the same transaction. Changing the email resets accountStatus to PENDING_EMAIL_VERIFICATION. Never accepts/sets a raw password value.',
  })
  updateUserAccount(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserAccountInput,
  ): Promise<UserAccountModel> {
    return this.updateUserAccountService.updateUserAccount(
      adminUserId,
      id,
      input,
    );
  }

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_WRITE)
  @Mutation(() => ForceUserAccountPasswordResetPayload, {
    description:
      'Triggers the same reset-code email flow requestPasswordReset uses for the given user. Never sets/accepts a raw password value — the user must still complete the reset themselves via resetPassword.',
  })
  forceUserAccountPasswordReset(
    @CurrentAdminUser() adminUserId: string,
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<ForceUserAccountPasswordResetPayload> {
    return this.forceUserAccountPasswordResetService.forceUserAccountPasswordReset(
      adminUserId,
      userId,
    );
  }

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_DELETE)
  @Mutation(() => DeleteUserAccountPayload, {
    description:
      'PERMANENTLY deletes a consumer user account and everything it owns (Session/EmailVerificationCode/PasswordResetCode/CustomerProfile/ProfessionalProfile, via Postgres onDelete: Cascade) — IRREVERSIBLE. Writes an AdminAuditLog row (with a minimal snapshot: email, hadCustomerProfile, hadProfessionalProfile) BEFORE the deletion, in the same transaction. Requires USER_ACCOUNTS_DELETE (SUPER_ADMIN only). A development/testing convenience, not a production data-retention mechanism — see ADR 0005.',
  })
  deleteUserAccount(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteUserAccountPayload> {
    return this.deleteUserAccountService.deleteUserAccount(adminUserId, id);
  }

  @RequireAdminPermissions(Permission.USER_ACCOUNTS_DELETE)
  @Mutation(() => BulkDeleteUserAccountsPayload, {
    description:
      'PERMANENTLY deletes every given user account id independently (same logic as deleteUserAccount, one AdminAuditLog row per success) — one bad/nonexistent id never aborts the rest of the batch. IRREVERSIBLE. Requires USER_ACCOUNTS_DELETE (SUPER_ADMIN only).',
  })
  bulkDeleteUserAccounts(
    @CurrentAdminUser() adminUserId: string,
    @Args('ids', { type: () => [ID] }) ids: string[],
  ): Promise<BulkDeleteUserAccountsPayload> {
    return this.bulkDeleteUserAccountsService.bulkDeleteUserAccounts(
      adminUserId,
      ids,
    );
  }
}
