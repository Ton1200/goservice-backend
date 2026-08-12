import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Pulls the `adminUserId` that `AdminSessionGuard`
 * (`../guards/admin-session.guard.ts`) attached to the request — the admin
 * parallel of `src/auth/decorators/current-user.decorator.ts`, written
 * from scratch (zero shared code). Only meaningful behind
 * `@UseGuards(AdminSessionGuard)`.
 */
export const CurrentAdminUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const req = GqlExecutionContext.create(context).getContext<{
      req: { adminUserId?: string };
    }>().req;
    return req.adminUserId as string;
  },
);
