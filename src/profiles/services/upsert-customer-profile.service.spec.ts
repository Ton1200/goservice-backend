import { Logger } from '@nestjs/common';
import { GeocodingPort } from '../../geo/ports/geocoding.port';
import { UpsertCustomerProfileInput } from '../models/upsert-customer-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';
import { UpsertCustomerProfileService } from './upsert-customer-profile.service';

describe('UpsertCustomerProfileService', () => {
  function makeService(overrides?: {
    wasCreated?: boolean;
    accountStatusTransitioned?: boolean;
    geocodeResult?: { latitude: number; longitude: number } | null;
    geocodeError?: Error;
  }) {
    const profile = {
      id: 'profile-1',
      displayName: 'Jane Doe',
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

    const geocode = overrides?.geocodeError
      ? jest.fn().mockRejectedValue(overrides.geocodeError)
      : jest.fn().mockResolvedValue(overrides?.geocodeResult ?? null);
    const geocodingPort = { geocode } as unknown as GeocodingPort;

    const service = new UpsertCustomerProfileService(
      profilesRepository,
      geocodingPort,
    );

    return { service, profile, upsertCustomerProfile, geocode };
  }

  function validInput(
    overrides?: Partial<UpsertCustomerProfileInput>,
  ): UpsertCustomerProfileInput {
    return {
      displayName: 'Jane Doe',
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
      displayName: 'Jane Doe',
      addressLine: 'Av. Siempreviva 742',
      city: 'CABA',
      province: 'Buenos Aires',
      country: 'AR',
      addressLatitude: null,
      addressLongitude: null,
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

  it('never logs PII field values (displayName/addressLine/city/province/country/photoUrl)', async () => {
    const { service } = makeService();

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ photoUrl: 'https://cdn.example.com/photo.jpg' }),
    );

    for (const call of logSpy.mock.calls as unknown[][]) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain('Jane Doe');
      expect(payload).not.toContain('Siempreviva');
      expect(payload).not.toContain('CABA');
      expect(payload).not.toContain('cdn.example.com');
    }
  });

  describe('geocoding (ADR 0006 / DEC-005)', () => {
    it('persists the geocoded coordinates when GeocodingPort resolves them', async () => {
      const { service, upsertCustomerProfile } = makeService({
        geocodeResult: { latitude: -34.6037, longitude: -58.3816 },
      });

      await service.upsertCustomerProfile('user-1', validInput());

      expect(upsertCustomerProfile).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          addressLatitude: -34.6037,
          addressLongitude: -58.3816,
        }),
      );
    });

    it('geocodes the full address (line + city + province + country), not just addressLine', async () => {
      const { service, geocode } = makeService({
        geocodeResult: { latitude: -34.6037, longitude: -58.3816 },
      });

      await service.upsertCustomerProfile('user-1', validInput());

      const [calledAddress] = geocode.mock.calls[0] as [string];
      expect(calledAddress).toContain('Av. Siempreviva 742');
      expect(calledAddress).toContain('CABA');
      expect(calledAddress).toContain('Buenos Aires');
      expect(calledAddress).toContain('AR');
    });

    it(
      'THE MANDATORY soft-fail case: when GeocodingPort.geocode returns null, ' +
        'the profile is still created with both coordinates null — never blocked',
      async () => {
        const { service, profile, upsertCustomerProfile } = makeService({
          geocodeResult: null,
        });

        const result = await service.upsertCustomerProfile(
          'user-1',
          validInput(),
        );

        expect(result).toBe(profile);
        expect(upsertCustomerProfile).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({
            addressLatitude: null,
            addressLongitude: null,
          }),
        );
      },
    );

    it(
      'THE MANDATORY soft-fail case: when GeocodingPort.geocode THROWS, ' +
        'the profile is still created with both coordinates null — never blocked, never rethrown',
      async () => {
        const { service, profile, upsertCustomerProfile } = makeService({
          geocodeError: new Error('ECONNRESET'),
        });

        const result = await service.upsertCustomerProfile(
          'user-1',
          validInput(),
        );

        expect(result).toBe(profile);
        expect(upsertCustomerProfile).toHaveBeenCalledWith(
          'user-1',
          expect.objectContaining({
            addressLatitude: null,
            addressLongitude: null,
          }),
        );
      },
    );

    it('logs geocoded: true/false, but never the coordinates themselves', async () => {
      const { service } = makeService({
        geocodeResult: { latitude: -34.6037, longitude: -58.3816 },
      });

      await service.upsertCustomerProfile('user-1', validInput());

      const profileUpsertedLog = (logSpy.mock.calls as unknown[][])
        .map((call) => call[0] as { event: string; geocoded?: boolean })
        .find((entry) => entry.event === 'profile_upserted');
      expect(profileUpsertedLog?.geocoded).toBe(true);

      for (const call of logSpy.mock.calls as unknown[][]) {
        const payload = JSON.stringify(call[0]);
        expect(payload).not.toContain('-34.6037');
        expect(payload).not.toContain('-58.3816');
      }
    });

    it('logs geocoded: false on a geocoding failure', async () => {
      const { service } = makeService({ geocodeError: new Error('boom') });

      await service.upsertCustomerProfile('user-1', validInput());

      const profileUpsertedLog = (logSpy.mock.calls as unknown[][])
        .map((call) => call[0] as { event: string; geocoded?: boolean })
        .find((entry) => entry.event === 'profile_upserted');
      expect(profileUpsertedLog?.geocoded).toBe(false);
    });
  });
});
