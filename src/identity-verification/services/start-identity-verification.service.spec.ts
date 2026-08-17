import { CountryCode, UserAccountStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { UsersRepository } from '../../users/users.repository';
import { DomainException } from '../../common/errors/domain-exception';
import { IdentityVerificationRepository } from '../identity-verification.repository';
import { IdentityVerificationProviderRegistry } from './identity-verification-provider-registry.service';
import { StartIdentityVerificationService } from './start-identity-verification.service';

interface CreatedRow {
  id: string;
  userId: string;
  country: CountryCode;
  provider: string;
  providerReference: string;
}

function buildService(overrides?: {
  accountStatus?: UserAccountStatus | null;
  country?: CountryCode | null;
}) {
  const findAccountStatusById = jest
    .fn()
    .mockResolvedValue(
      overrides?.accountStatus ?? UserAccountStatus.PENDING_APPROVAL,
    );
  const usersRepository = {
    findAccountStatusById,
  } as unknown as UsersRepository;

  // `??` would treat an explicit `overrides.country === null` (the "no
  // profile found" test case) the same as "not provided", silently
  // defaulting it back to AR — `in` distinguishes "key present, possibly
  // null" from "key genuinely omitted".
  const resolvedCountry =
    overrides && 'country' in overrides ? overrides.country : CountryCode.AR;
  const findCountryForUser = jest.fn().mockResolvedValue(resolvedCountry);
  const profilesRepository = {
    findCountryForUser,
  } as unknown as ProfilesRepository;

  const createSession = jest.fn().mockResolvedValue({
    providerReference: 'session-123',
    verificationUrl: 'https://verify.didit.me/session-123',
  });
  const adapter = { createSession };

  const resolve = jest.fn().mockResolvedValue(adapter);
  const identityVerificationProviderRegistry = {
    resolve,
  } as unknown as IdentityVerificationProviderRegistry;

  const create = jest.fn().mockImplementation((data: CreatedRow) =>
    Promise.resolve({
      ...data,
      documentType: 'UNKNOWN',
      documentCheckPassed: null,
      biometricCheckPassed: null,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
  const identityVerificationRepository = {
    create,
  } as unknown as IdentityVerificationRepository;

  const service = new StartIdentityVerificationService(
    usersRepository,
    profilesRepository,
    identityVerificationRepository,
    identityVerificationProviderRegistry,
  );

  return {
    service,
    findAccountStatusById,
    findCountryForUser,
    createSession,
    resolve,
    create,
  };
}

describe('StartIdentityVerificationService', () => {
  it('throws ACCOUNT_NOT_PENDING_APPROVAL when the account is not PENDING_APPROVAL', async () => {
    const { service } = buildService({
      accountStatus: UserAccountStatus.APPROVED,
    });

    await expect(
      service.startIdentityVerification('user-1'),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: 'ACCOUNT_NOT_PENDING_APPROVAL',
    });
  });

  it('resolves country server-side and never accepts one as an argument', async () => {
    const { service, findCountryForUser, resolve } = buildService({
      country: CountryCode.CO,
    });

    await service.startIdentityVerification('user-1');

    expect(findCountryForUser).toHaveBeenCalledWith('user-1');
    expect(resolve).toHaveBeenCalledWith(CountryCode.CO);
  });

  it('creates the session with a generated id as vendor_data BEFORE persisting, then persists with the returned providerReference', async () => {
    const { service, createSession, create } = buildService();

    const result = await service.startIdentityVerification('user-1');

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        identityVerificationId: expect.any(String) as unknown,
        country: CountryCode.AR,
      }),
    );
    const sentId = (
      createSession.mock.calls[0] as [{ identityVerificationId: string }]
    )[0].identityVerificationId;

    expect(create).toHaveBeenCalledWith({
      id: sentId,
      userId: 'user-1',
      country: CountryCode.AR,
      provider: 'didit',
      providerReference: 'session-123',
    });
    expect(result).toEqual({
      id: sentId,
      status: 'PENDING',
      documentCheckPassed: null,
      biometricCheckPassed: null,
      verificationUrl: 'https://verify.didit.me/session-123',
    });
  });

  it('throws when neither profile resolves a country, without ever calling the registry', async () => {
    const { service, resolve } = buildService({ country: null });

    await expect(service.startIdentityVerification('user-1')).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });
});
