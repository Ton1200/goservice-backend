import { Logger } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { UpsertCustomerProfileInput } from '../models/upsert-customer-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';
import { UpsertCustomerProfileService } from './upsert-customer-profile.service';

describe('UpsertCustomerProfileService', () => {
  function makeService(overrides?: {
    wasCreated?: boolean;
    accountStatusTransitioned?: boolean;
    featureEnabled?: boolean;
    usableRef?: { id: string; fileUrl: string } | null;
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
    const findUsablePendingPhotoUploadRef = jest
      .fn()
      .mockResolvedValue(
        overrides?.usableRef === undefined ? null : overrides.usableRef,
      );
    const profilesRepository = {
      upsertCustomerProfile,
      findUsablePendingPhotoUploadRef,
    } as unknown as ProfilesRepository;

    const isEnabled = jest
      .fn()
      .mockResolvedValue(overrides?.featureEnabled ?? true);
    const platformSettingPort = {
      isEnabled,
      getValue: jest.fn(),
    } as unknown as PlatformSettingPort;

    const service = new UpsertCustomerProfileService(
      profilesRepository,
      platformSettingPort,
    );

    return {
      service,
      profile,
      upsertCustomerProfile,
      findUsablePendingPhotoUploadRef,
      isEnabled,
    };
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
      photoUrl: undefined,
      photoUploadRefId: undefined,
      locationSharingEnabled: undefined,
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

  it('resolves a usable photoUploadRef to photoUrl + photoUploadRefId', async () => {
    const { service, upsertCustomerProfile, findUsablePendingPhotoUploadRef } =
      makeService({
        usableRef: {
          id: 'ref-1',
          fileUrl: 'http://localhost:3000/uploads/abc.webp',
        },
      });

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ photoUploadRef: 'ref-1' }),
    );

    expect(findUsablePendingPhotoUploadRef).toHaveBeenCalledWith(
      'user-1',
      'ref-1',
    );
    expect(upsertCustomerProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        photoUrl: 'http://localhost:3000/uploads/abc.webp',
        photoUploadRefId: 'ref-1',
      }),
    );
  });

  it('rejects an unusable photoUploadRef with INVALID_PROFILE_PHOTO_UPLOAD_REF', async () => {
    const { service, upsertCustomerProfile } = makeService({ usableRef: null });

    await expect(
      service.upsertCustomerProfile(
        'user-1',
        validInput({ photoUploadRef: 'ref-x' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE_PHOTO_UPLOAD_REF' });
    expect(upsertCustomerProfile).not.toHaveBeenCalled();
  });

  it('rejects a photoUploadRef when the feature toggle is off', async () => {
    const { service, findUsablePendingPhotoUploadRef, upsertCustomerProfile } =
      makeService({ featureEnabled: false });

    await expect(
      service.upsertCustomerProfile(
        'user-1',
        validInput({ photoUploadRef: 'ref-1' }),
      ),
    ).rejects.toMatchObject({ code: 'PROFILE_PHOTO_UPLOAD_DISABLED' });
    expect(findUsablePendingPhotoUploadRef).not.toHaveBeenCalled();
    expect(upsertCustomerProfile).not.toHaveBeenCalled();
  });

  it('passes photoUrl/photoUploadRefId through as undefined when no ref is submitted', async () => {
    const { service, upsertCustomerProfile, findUsablePendingPhotoUploadRef } =
      makeService();

    await service.upsertCustomerProfile('user-1', validInput());

    expect(findUsablePendingPhotoUploadRef).not.toHaveBeenCalled();
    const callArg = (upsertCustomerProfile.mock.calls as unknown[][])[0][1] as {
      photoUrl?: string;
      photoUploadRefId?: string;
    };
    expect(callArg.photoUrl).toBeUndefined();
    expect(callArg.photoUploadRefId).toBeUndefined();
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

  it('never logs PII field values or the resolved photo URL', async () => {
    const { service } = makeService({
      usableRef: {
        id: 'ref-1',
        fileUrl: 'http://localhost:3000/uploads/secret-key.webp',
      },
    });

    await service.upsertCustomerProfile(
      'user-1',
      validInput({ photoUploadRef: 'ref-1' }),
    );

    for (const call of logSpy.mock.calls as unknown[][]) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain('Jane');
      expect(payload).not.toContain('Doe');
      expect(payload).not.toContain('Siempreviva');
      expect(payload).not.toContain('CABA');
      expect(payload).not.toContain('secret-key');
    }
  });
});
