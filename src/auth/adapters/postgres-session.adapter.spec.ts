import { ConfigService } from '@nestjs/config';
import { SessionStatus } from '@prisma/client';
import { SessionsRepository } from '../sessions.repository';
import { hashSessionToken } from '../services/session-token.util';
import { PostgresSessionAdapter } from './postgres-session.adapter';

describe('PostgresSessionAdapter', () => {
  function makeAdapter(options?: { ttlHours?: number }) {
    const create = jest.fn(
      (data: { userId: string; tokenHash: string; expiresAt: Date }) => {
        void data; // referenced only so the mock's arg type is inferred
        return Promise.resolve({ id: 'session-1' });
      },
    );
    const findByTokenHash = jest.fn();
    const markExpired = jest.fn();
    const markRevoked = jest.fn();
    const sessionsRepository = {
      create,
      findByTokenHash,
      markExpired,
      markRevoked,
    } as unknown as SessionsRepository;

    const configService = {
      get: jest.fn().mockReturnValue({ ttlHours: options?.ttlHours ?? 720 }),
    } as unknown as ConfigService;

    const adapter = new PostgresSessionAdapter(
      sessionsRepository,
      configService as never,
    );

    return { adapter, create, findByTokenHash, markExpired, markRevoked };
  }

  describe('createSession', () => {
    it('persists only the token hash — never the plaintext token — and returns the plaintext once', async () => {
      const { adapter, create } = makeAdapter();

      const result = await adapter.createSession({ userId: 'user-1' });

      expect(typeof result.sessionToken).toBe('string');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(create).toHaveBeenCalledTimes(1);
      const createArg = create.mock.calls[0][0];
      expect(createArg.userId).toBe('user-1');
      expect(createArg.tokenHash).not.toBe(result.sessionToken);
      expect(createArg.tokenHash).toBe(hashSessionToken(result.sessionToken));
    });

    it('sets expiresAt using the configured SESSION_TTL_HOURS', async () => {
      const { adapter } = makeAdapter({ ttlHours: 1 });
      const before = Date.now();

      const result = await adapter.createSession({ userId: 'user-1' });

      const expectedMin = before + 59 * 60 * 1000;
      const expectedMax = Date.now() + 61 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThan(expectedMin);
      expect(result.expiresAt.getTime()).toBeLessThan(expectedMax);
    });
  });

  describe('findActiveSessionUserId', () => {
    it('returns the userId for an ACTIVE, unexpired session', async () => {
      const { adapter, findByTokenHash } = makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const userId = await adapter.findActiveSessionUserId('some-token');

      expect(userId).toBe('user-1');
    });

    it('returns null and lazily marks EXPIRED when past expiresAt', async () => {
      const { adapter, findByTokenHash, markExpired } = makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 60_000),
      });
      markExpired.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const userId = await adapter.findActiveSessionUserId('some-token');

      expect(userId).toBeNull();
      expect(markExpired).toHaveBeenCalledWith('session-1');
    });

    it('returns null for an unknown token, without writing anything', async () => {
      const { adapter, findByTokenHash, markExpired } = makeAdapter();
      findByTokenHash.mockResolvedValue(null);

      const userId = await adapter.findActiveSessionUserId('unknown-token');

      expect(userId).toBeNull();
      expect(markExpired).not.toHaveBeenCalled();
    });

    it('returns null for a REVOKED session', async () => {
      const { adapter, findByTokenHash } = makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.REVOKED,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const userId = await adapter.findActiveSessionUserId('some-token');

      expect(userId).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('revokes an ACTIVE, unexpired session and returns true', async () => {
      const { adapter, findByTokenHash, markRevoked } = makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await adapter.revokeSession('some-token');

      expect(result).toBe(true);
      expect(markRevoked).toHaveBeenCalledWith('session-1');
    });

    it('is idempotent: returns false for an already-REVOKED session', async () => {
      const { adapter, findByTokenHash, markRevoked } = makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.REVOKED,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await adapter.revokeSession('some-token');

      expect(result).toBe(false);
      expect(markRevoked).not.toHaveBeenCalled();
    });

    it('returns false and lazily marks EXPIRED for a past-expiry ACTIVE session', async () => {
      const { adapter, findByTokenHash, markExpired, markRevoked } =
        makeAdapter();
      findByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 60_000),
      });
      markExpired.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        status: SessionStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const result = await adapter.revokeSession('some-token');

      expect(result).toBe(false);
      expect(markExpired).toHaveBeenCalledWith('session-1');
      expect(markRevoked).not.toHaveBeenCalled();
    });

    it('returns false for an unknown token, without writing anything', async () => {
      const { adapter, findByTokenHash, markRevoked, markExpired } =
        makeAdapter();
      findByTokenHash.mockResolvedValue(null);

      const result = await adapter.revokeSession('unknown-token');

      expect(result).toBe(false);
      expect(markRevoked).not.toHaveBeenCalled();
      expect(markExpired).not.toHaveBeenCalled();
    });
  });
});
