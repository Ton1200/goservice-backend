import { SessionPort } from '../ports/session.port';
import { LogoutService } from './logout.service';

describe('LogoutService', () => {
  function makeService(revokeResult: boolean) {
    const revokeSession = jest.fn().mockResolvedValue(revokeResult);
    const sessionPort = { revokeSession } as unknown as SessionPort;
    const service = new LogoutService(sessionPort);
    return { service, revokeSession };
  }

  it('revokes an active session and returns true', async () => {
    const { service, revokeSession } = makeService(true);

    const result = await service.logout('some-token');

    expect(result).toBe(true);
    expect(revokeSession).toHaveBeenCalledWith('some-token');
  });

  it('returns false, without throwing, for an unknown/already-revoked/expired token', async () => {
    const { service } = makeService(false);

    await expect(service.logout('unknown-token')).resolves.toBe(false);
  });

  it('returns false without calling revokeSession when sessionToken is null (no/malformed Authorization header)', async () => {
    const { service, revokeSession } = makeService(false);

    await expect(service.logout(null)).resolves.toBe(false);

    expect(revokeSession).not.toHaveBeenCalled();
  });
});
