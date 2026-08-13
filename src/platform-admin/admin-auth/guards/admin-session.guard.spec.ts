import { ExecutionContext } from '@nestjs/common';
import { AdminSessionPort } from '../ports/admin-session.port';
import { AdminSessionGuard } from './admin-session.guard';

/**
 * Same minimal fake `ExecutionContext` shape as
 * `src/auth/guards/session.guard.spec.ts` — see that file's comment for
 * why this avoids spinning up a real Apollo execution context.
 */
function makeExecutionContext(req: unknown): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => [{}, {}, { req }, {}],
    getClass: () => class {},
    getHandler: () => (): void => undefined,
  } as unknown as ExecutionContext;
}

describe('AdminSessionGuard', () => {
  function makeGuard(adminUserId: string | null) {
    const findActiveSessionAdminUserId = jest
      .fn()
      .mockResolvedValue(adminUserId);
    const adminSessionPort = {
      findActiveSessionAdminUserId,
    } as unknown as AdminSessionPort;
    const guard = new AdminSessionGuard(adminSessionPort);
    return { guard, findActiveSessionAdminUserId };
  }

  it('rejects with ADMIN_UNAUTHENTICATED when there is no Authorization header', async () => {
    const { guard } = makeGuard('admin-1');
    const req: { headers: Record<string, string>; adminUserId?: string } = {
      headers: {},
    };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });
    expect(req.adminUserId).toBeUndefined();
  });

  it('rejects with ADMIN_UNAUTHENTICATED for a malformed Authorization header', async () => {
    const { guard } = makeGuard('admin-1');
    const req = { headers: { authorization: 'not-a-bearer-token' } };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });
  });

  it('rejects with ADMIN_UNAUTHENTICATED when the token does not resolve to an active session', async () => {
    const { guard } = makeGuard(null);
    const req = { headers: { authorization: 'Bearer unknown-token' } };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });
  });

  it('passes (true) and attaches adminUserId to the request for a valid, active session token', async () => {
    const { guard, findActiveSessionAdminUserId } = makeGuard('admin-42');
    const req: { headers: Record<string, string>; adminUserId?: string } = {
      headers: { authorization: 'Bearer real-token' },
    };

    await expect(guard.canActivate(makeExecutionContext(req))).resolves.toBe(
      true,
    );
    expect(req.adminUserId).toBe('admin-42');
    expect(findActiveSessionAdminUserId).toHaveBeenCalledWith('real-token');
  });
});
