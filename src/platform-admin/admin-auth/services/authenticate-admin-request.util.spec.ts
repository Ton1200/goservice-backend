import { DomainException } from '../../../common/errors/domain-exception';
import { AdminSessionPort } from '../ports/admin-session.port';
import { authenticateAdminRequest } from './authenticate-admin-request.util';

describe('authenticateAdminRequest', () => {
  function makeAdminSessionPort(returnValue: string | null) {
    const findActiveSessionAdminUserId = jest
      .fn()
      .mockResolvedValue(returnValue);
    const adminSessionPort = {
      findActiveSessionAdminUserId,
    } as unknown as AdminSessionPort;
    return { adminSessionPort, findActiveSessionAdminUserId };
  }

  it('rejects with ADMIN_UNAUTHENTICATED when the Authorization header is missing', async () => {
    const { adminSessionPort, findActiveSessionAdminUserId } =
      makeAdminSessionPort('admin-1');

    await expect(
      authenticateAdminRequest(undefined, adminSessionPort),
    ).rejects.toMatchObject({
      code: 'ADMIN_UNAUTHENTICATED',
      message: 'Admin authentication required.',
    });
    expect(findActiveSessionAdminUserId).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-bearer-header',
    'bearer lowercase-scheme',
    'Bearer',
    'Bearer ',
    'Basic dXNlcjpwYXNz',
  ])(
    'rejects with ADMIN_UNAUTHENTICATED for a malformed header (%p)',
    async (header) => {
      const { adminSessionPort, findActiveSessionAdminUserId } =
        makeAdminSessionPort('admin-1');

      await expect(
        authenticateAdminRequest(header, adminSessionPort),
      ).rejects.toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });
      expect(findActiveSessionAdminUserId).not.toHaveBeenCalled();
    },
  );

  it('rejects with ADMIN_UNAUTHENTICATED when the token does not map to an active session (covers unknown/expired/revoked, all indistinguishable at this layer)', async () => {
    const { adminSessionPort, findActiveSessionAdminUserId } =
      makeAdminSessionPort(null);

    await expect(
      authenticateAdminRequest('Bearer unknown-token', adminSessionPort),
    ).rejects.toMatchObject({ code: 'ADMIN_UNAUTHENTICATED' });
    expect(findActiveSessionAdminUserId).toHaveBeenCalledWith('unknown-token');
  });

  it('resolves with the adminUserId for a well-formed header and a real, active session token', async () => {
    const { adminSessionPort, findActiveSessionAdminUserId } =
      makeAdminSessionPort('admin-42');

    await expect(
      authenticateAdminRequest('Bearer real-token', adminSessionPort),
    ).resolves.toBe('admin-42');
    expect(findActiveSessionAdminUserId).toHaveBeenCalledWith('real-token');
  });

  it('all thrown failures are DomainException instances', async () => {
    const { adminSessionPort } = makeAdminSessionPort(null);

    await expect(
      authenticateAdminRequest(undefined, adminSessionPort),
    ).rejects.toBeInstanceOf(DomainException);
  });
});
