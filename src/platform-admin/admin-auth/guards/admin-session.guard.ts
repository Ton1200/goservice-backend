import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AdminSessionPort } from '../ports/admin-session.port';
import { authenticateAdminRequest } from '../services/authenticate-admin-request.util';

interface RequestWithAdminSession {
  headers: { authorization?: string };
  adminUserId?: string;
}

/**
 * The `/admin/graphql` parallel of `src/auth/guards/session.guard.ts` — a
 * from-scratch duplicate (zero shared code, per the platform-admin plan's
 * explicit isolation requirement), not a subclass/wrapper around it. Apply
 * `@UseGuards(AdminSessionGuard)` to any admin resolver that requires an
 * authenticated admin; pair with `AdminPermissionsGuard`
 * (`../../admin-rbac/guards/admin-permissions.guard.ts`) — in that order —
 * for resolvers that additionally require specific `Permission`s.
 *
 * On success, attaches the resolved `adminUserId` to the request so
 * `@CurrentAdminUser()` (`../decorators/current-admin-user.decorator.ts`)
 * can read it back out.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly adminSessionPort: AdminSessionPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = GqlExecutionContext.create(context).getContext<{
      req: RequestWithAdminSession;
    }>().req;

    req.adminUserId = await authenticateAdminRequest(
      req.headers.authorization,
      this.adminSessionPort,
    );
    return true;
  }
}
