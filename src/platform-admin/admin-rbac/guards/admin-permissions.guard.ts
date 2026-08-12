import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { AdminRbacService } from '../services/admin-rbac.service';
import { ADMIN_PERMISSIONS_METADATA_KEY } from '../decorators/require-admin-permissions.decorator';

interface RequestWithAdminUser {
  adminUserId?: string;
}

/**
 * Must run AFTER `AdminSessionGuard` (`../../admin-auth/guards/admin-session.guard.ts`)
 * — `@UseGuards(AdminSessionGuard, AdminPermissionsGuard)`, in that order —
 * since it reads `req.adminUserId`, which only `AdminSessionGuard` sets. A
 * method with no `@RequireAdminPermissions(...)` metadata is allowed
 * through unconditionally (this guard enforces PERMISSIONS, not
 * authentication — pair it with `AdminSessionGuard` for that).
 *
 * `ADMIN_FORBIDDEN` is deliberately distinct from `ADMIN_UNAUTHENTICATED`
 * (thrown by `AdminSessionGuard`/`authenticate-admin-request.util.ts`): the
 * former means "we know who you are, you just can't do this"; the latter
 * means "we don't know who you are at all". Never collapsed into one code
 * — an authenticated-but-underprivileged admin needs a UI that can tell the
 * two apart (e.g. "log in again" vs. "ask a SUPER_ADMIN").
 */
@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminRbacService: AdminRbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(
        ADMIN_PERMISSIONS_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    if (required.length === 0) {
      return true;
    }

    const req = GqlExecutionContext.create(context).getContext<{
      req: RequestWithAdminUser;
    }>().req;

    const hasPermission = req.adminUserId
      ? await this.adminRbacService.hasAllPermissions(req.adminUserId, required)
      : false;

    if (!hasPermission) {
      throw new DomainException(
        'ADMIN_FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}
