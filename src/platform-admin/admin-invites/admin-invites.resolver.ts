import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminUserModel } from '../admin-users/models/admin-user.model';
import { InviteAdminUserService } from './services/invite-admin-user.service';
import { ResendAdminInviteService } from './services/resend-admin-invite.service';
import { InviteAdminUserInput } from './models/invite-admin-user.input';
import { ResendAdminInvitePayload } from './models/resend-admin-invite-payload.model';

/**
 * Thin delivery adapter for the GUARDED half of the invite flow —
 * `inviteAdminUser`/`resendAdminInvite`, both `ADMIN_USERS_MANAGE`, normal
 * `AdminSessionGuard` + `AdminPermissionsGuard` guard ordering. The
 * UNGUARDED third mutation, `acceptAdminInvite`, deliberately lives on its
 * OWN, SEPARATE resolver class (`AcceptAdminInviteResolver`,
 * `accept-admin-invite.resolver.ts`) — putting it here would inherit this
 * class's own `@UseGuards(...)` regardless of what (or what not) is put on
 * the method itself.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminInvitesResolver {
  constructor(
    private readonly inviteAdminUserService: InviteAdminUserService,
    private readonly resendAdminInviteService: ResendAdminInviteService,
  ) {}

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => AdminUserModel, {
    description:
      'Creates a new AdminUser (status INVITED, no password set) and emails them an invite link. Rejects a duplicate email (ADMIN_USER_EMAIL_TAKEN) or a nonexistent roleId (ADMIN_ROLE_NOT_FOUND). Requires email delivery to be configured/enabled (EMAIL_DELIVERY_DISABLED/EMAIL_DELIVERY_MISCONFIGURED otherwise). Writes an AdminAuditLog row.',
  })
  inviteAdminUser(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: InviteAdminUserInput,
  ): Promise<AdminUserModel> {
    return this.inviteAdminUserService.inviteAdminUser(adminUserId, input);
  }

  @RequireAdminPermissions(Permission.ADMIN_USERS_MANAGE)
  @Mutation(() => ResendAdminInvitePayload, {
    description:
      'Re-sends an invite email for an AdminUser still in INVITED status (ADMIN_USER_NOT_INVITED otherwise), subject to the same resend cooldown as the original invite. Returns success: false (not an error) when the cooldown has not yet elapsed — no new email is sent in that case.',
  })
  resendAdminInvite(
    @CurrentAdminUser() adminUserId: string,
    @Args('adminUserId', { type: () => ID }) targetAdminUserId: string,
  ): Promise<ResendAdminInvitePayload> {
    return this.resendAdminInviteService.resendAdminInvite(
      adminUserId,
      targetAdminUserId,
    );
  }
}
