import { DomainException } from '../../common/errors/domain-exception';
import { SessionPort } from '../ports/session.port';
import { authenticateRequest } from './authenticate-request.util';

describe('authenticateRequest', () => {
  function makeSessionPort(returnValue: string | null) {
    const findActiveSessionUserId = jest.fn().mockResolvedValue(returnValue);
    const sessionPort = { findActiveSessionUserId } as unknown as SessionPort;
    return { sessionPort, findActiveSessionUserId };
  }

  it('rejects with UNAUTHENTICATED when the Authorization header is missing', async () => {
    const { sessionPort, findActiveSessionUserId } = makeSessionPort('user-1');

    await expect(
      authenticateRequest(undefined, sessionPort),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
    expect(findActiveSessionUserId).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-bearer-header',
    'bearer lowercase-scheme', // wrong case
    'Bearer', // no trailing space / no token at all
    'Bearer ', // empty token after the prefix
    'Basic dXNlcjpwYXNz', // different scheme entirely
  ])(
    'rejects with UNAUTHENTICATED for a malformed header (%p)',
    async (header) => {
      const { sessionPort, findActiveSessionUserId } =
        makeSessionPort('user-1');

      await expect(
        authenticateRequest(header, sessionPort),
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
      expect(findActiveSessionUserId).not.toHaveBeenCalled();
    },
  );

  it('rejects with UNAUTHENTICATED when the token does not map to an active session', async () => {
    const { sessionPort, findActiveSessionUserId } = makeSessionPort(null);

    await expect(
      authenticateRequest('Bearer unknown-token', sessionPort),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
    expect(findActiveSessionUserId).toHaveBeenCalledWith('unknown-token');
  });

  it('resolves with the userId for a well-formed header and a real, active session token', async () => {
    const { sessionPort, findActiveSessionUserId } = makeSessionPort('user-42');

    await expect(
      authenticateRequest('Bearer real-token', sessionPort),
    ).resolves.toBe('user-42');
    expect(findActiveSessionUserId).toHaveBeenCalledWith('real-token');
  });

  it('all thrown failures are DomainException instances', async () => {
    const { sessionPort } = makeSessionPort(null);

    await expect(
      authenticateRequest(undefined, sessionPort),
    ).rejects.toBeInstanceOf(DomainException);
  });
});
