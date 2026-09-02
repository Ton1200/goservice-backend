import { Logger } from '@nestjs/common';
import { UpsertCustomerProfileInput } from '../models/upsert-customer-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';
import { UpsertCustomerProfileService } from './upsert-customer-profile.service';

describe('UpsertCustomerProfileService', () => {
  function makeService(overrides?: {
    wasCreated?: boolean;
    accountStatusTransitioned?: boolean;
  }) {
    const profile = {
      id: 'profile-1',
      firstName: 'Jane',
      lastName: 'Doe',
      addressLine: 'Av. Siempreviva 742',
      city: 'CABA',
      province: 'Buenos Aires',
      country: 'AR',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const upsertCustomerProfile = jest.fn().mockResolvedValue({
      profile,
      wasCreated: overrides?.wasCreated ?? true,
      accountStatusTransitioned: overrides?.accountStatusTransitioned ?? true,
    });
    const profilesRepository = {
      upsertCustomerProfile,
    } as unknown as ProfilesRepository;

    const service = new UpsertCustomerProfileService(profilesRepository);

    return { service, profile, upsertCustomerProfile };
  }

  function validInput(
    overrides?: Partial<UpsertCustomerProfileInput>,
  ): UpsertCustomerProfileInput {
    return {
      firstName: 'Jane',
      lastName: 'Doe',
      addressLine: 'Av. Siempreviva 742',
      city: 'CABA',
      province: 'Buenos Aires',
      ...overrides,
    };
  }

  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('creates on first call and returns the repository profile unchanged', async () => {
    const { service, profile, upsertCustomerProfile } = makeService({
      wasCreated: true,
    });

    const result = await service.upsertCustomerProfile('user-1', validInput());

    expect(result).toBe(profile);
    expect(upsertCustomerProfile).toHaveBeenCalledWith('user-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      addressLine: 'Av. Siempreviva 742',
      city: 'CABA',
      province: 'Buenos Aires',
      country: 'AR',
    });
  });

  it('defaults country to "AR" when omitted from the input', async () => {
    const { service, upsertCustomerProfile } = makeService();

    await service.upsertCustomerProfile('user-1', validInput());

    expect(upsertCustomerProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ country: 'AR' }),
    );
  });

  it('passes photoUrl through to the repository when provided', async () => {
    const { service, upsertCustomerProfile } = makeService();

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ photoUrl: 'https://cdn.example.com/photo.jpg' }),
    );

    expect(upsertCustomerProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        photoUrl: 'https://cdn.example.com/photo.jpg',
      }),
    );
  });

  it('passes photoUrl through as undefined (not a wipe value) when omitted', async () => {
    const { service, upsertCustomerProfile } = makeService();

    await service.upsertCustomerProfile('user-1', validInput());

    const callArg = (upsertCustomerProfile.mock.calls as unknown[][])[0][1] as {
      photoUrl?: string;
    };
    expect(callArg.photoUrl).toBeUndefined();
  });

  it('passes locationSharingEnabled through to the repository when provided', async () => {
    const { service, upsertCustomerProfile } = makeService();

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ locationSharingEnabled: true }),
    );

    expect(upsertCustomerProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ locationSharingEnabled: true }),
    );
  });

  it('passes locationSharingEnabled through as undefined (not a wipe/reset-to-false value) when omitted', async () => {
    const { service, upsertCustomerProfile } = makeService();

    await service.upsertCustomerProfile('user-1', validInput());

    const callArg = (upsertCustomerProfile.mock.calls as unknown[][])[0][1] as {
      locationSharingEnabled?: boolean;
    };
    expect(callArg.locationSharingEnabled).toBeUndefined();
  });

  it('passes through a non-default country when provided', async () => {
    const { service, upsertCustomerProfile } = makeService();

    // 'UY' is no longer a valid value now that `country` is a real
    // `CountryCode` enum (AR/CO only, see `country-code.enum.ts`) — 'CO'
    // exercises the exact same "non-default country passes through
    // unchanged" behavior this test is actually about.
    await service.upsertCustomerProfile(
      'user-1',
      validInput({ country: 'CO' }),
    );

    expect(upsertCustomerProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ country: 'CO' }),
    );
  });

  it('idempotency: a second call for the same user always targets the same userId', async () => {
    const { service, upsertCustomerProfile } = makeService({
      wasCreated: false,
      accountStatusTransitioned: false,
    });

    await service.upsertCustomerProfile('user-1', validInput());
    await service.upsertCustomerProfile(
      'user-1',
      validInput({ city: 'Rosario' }),
    );

    expect(upsertCustomerProfile).toHaveBeenNthCalledWith(
      1,
      'user-1',
      expect.anything(),
    );
    expect(upsertCustomerProfile).toHaveBeenNthCalledWith(
      2,
      'user-1',
      expect.anything(),
    );
  });

  it('logs account_status_transition only when the repository reports the transition happened', async () => {
    const { service } = makeService({
      wasCreated: true,
      accountStatusTransitioned: true,
    });

    await service.upsertCustomerProfile('user-1', validInput());

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'account_status_transition' }),
    );
  });

  it('never logs account_status_transition on an edit (second call), and logs customer_profile_updated', async () => {
    const { service } = makeService({
      wasCreated: false,
      accountStatusTransitioned: false,
    });

    await service.upsertCustomerProfile('user-1', validInput());

    const events = (logSpy.mock.calls as unknown[][]).map(
      (call) => (call[0] as { event: string }).event,
    );
    expect(events).not.toContain('account_status_transition');
    expect(events).toContain('customer_profile_updated');
  });

  it('logs customer_profile_created on creation, not customer_profile_updated', async () => {
    const { service } = makeService({ wasCreated: true });

    await service.upsertCustomerProfile('user-1', validInput());

    const events = (logSpy.mock.calls as unknown[][]).map(
      (call) => (call[0] as { event: string }).event,
    );
    expect(events).toContain('customer_profile_created');
    expect(events).not.toContain('customer_profile_updated');
  });

  it('never logs PII field values (firstName/lastName/addressLine/city/province/country/photoUrl)', async () => {
    const { service } = makeService();

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ photoUrl: 'https://cdn.example.com/photo.jpg' }),
    );

    for (const call of logSpy.mock.calls as unknown[][]) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain('Jane');
      expect(payload).not.toContain('Doe');
      expect(payload).not.toContain('Siempreviva');
      expect(payload).not.toContain('CABA');
      expect(payload).not.toContain('cdn.example.com');
    }
  });
});
