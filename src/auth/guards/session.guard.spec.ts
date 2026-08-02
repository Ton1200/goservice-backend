import { ExecutionContext } from '@nestjs/common';
import { SessionPort } from '../ports/session.port';
import { SessionGuard } from './session.guard';

/**
 * Builds a minimal fake `ExecutionContext` shaped exactly the way
 * `GqlExecutionContext.create()` expects (see
 * `@nestjs/graphql`'s `gql-execution-context.js`: it calls
 * `context.getType()`/`getArgs()`/`getClass()`/`getHandler()`, and for a
 * standard resolver method call (4 args) `getArgs()` is used as-is —
 * `[root, args, context, info]`). This avoids spinning up a real Apollo
 * execution context just to unit-test the guard's request-object wiring;
 * the header-parsing/`SessionPort` logic itself is unit-tested directly in
 * `authenticate-request.util.spec.ts`.
 */
function makeExecutionContext(req: unknown): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => [{}, {}, { req }, {}],
    getClass: () => class {},
    getHandler: () => (): void => undefined,
  } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  function makeGuard(userId: string | null) {
    const findActiveSessionUserId = jest.fn().mockResolvedValue(userId);
    const sessionPort = { findActiveSessionUserId } as unknown as SessionPort;
    const guard = new SessionGuard(sessionPort);
    return { guard, findActiveSessionUserId };
  }

  it('rejects with UNAUTHENTICATED when there is no Authorization header', async () => {
    const { guard } = makeGuard('user-1');
    const req: { headers: Record<string, string>; userId?: string } = {
      headers: {},
    };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(req.userId).toBeUndefined();
  });

  it('rejects with UNAUTHENTICATED for a malformed Authorization header', async () => {
    const { guard } = makeGuard('user-1');
    const req = { headers: { authorization: 'not-a-bearer-token' } };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects with UNAUTHENTICATED when the token does not resolve to an active session', async () => {
    const { guard } = makeGuard(null);
    const req = { headers: { authorization: 'Bearer unknown-token' } };

    await expect(
      guard.canActivate(makeExecutionContext(req)),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('passes (true) and attaches userId to the request for a valid, active session token', async () => {
    const { guard, findActiveSessionUserId } = makeGuard('user-42');
    const req: { headers: Record<string, string>; userId?: string } = {
      headers: { authorization: 'Bearer real-token' },
    };

    await expect(guard.canActivate(makeExecutionContext(req))).resolves.toBe(
      true,
    );
    expect(req.userId).toBe('user-42');
    expect(findActiveSessionUserId).toHaveBeenCalledWith('real-token');
  });
});
