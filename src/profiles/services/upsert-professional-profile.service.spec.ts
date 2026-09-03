import { Logger } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { SpecializationRole } from '../models/specialization-role.enum';
import { UpsertProfessionalProfileInput } from '../models/upsert-professional-profile-input.model';
import { ProfilesRepository } from '../profiles.repository';
import { UpsertProfessionalProfileService } from './upsert-professional-profile.service';

describe('UpsertProfessionalProfileService', () => {
  function makeService(overrides?: {
    existingCategoryIds?: string[];
    wasCreated?: boolean;
    accountStatusTransitioned?: boolean;
    featureEnabled?: boolean;
    usableRef?: { id: string; fileUrl: string } | null;
  }) {
    const profile = {
      id: 'profile-1',
      firstName: 'Juan',
      lastName: 'Perez',
      displayName: null,
      city: 'CABA',
      country: 'AR',
      serviceAreaDescription: 'CABA y GBA Norte',
      bio: 'Trabajo en el rubro hace mas de una decada.',
      verificationStatus: 'UNVERIFIED',
      specializations: [
        {
          category: { id: 'cat-1', name: 'Plomería' },
          role: SpecializationRole.PRIMARY,
          description: 'Plomero con 10 años de experiencia.',
          yearsOfExperience: 10,
          order: 0,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findExistingCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.existingCategoryIds ?? ['cat-1']);
    const upsertProfessionalProfile = jest.fn().mockResolvedValue({
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
      findExistingCategoryIds,
      upsertProfessionalProfile,
      findUsablePendingPhotoUploadRef,
    } as unknown as ProfilesRepository;

    const isEnabled = jest
      .fn()
      .mockResolvedValue(overrides?.featureEnabled ?? true);
    const platformSettingPort = {
      isEnabled,
      getValue: jest.fn(),
    } as unknown as PlatformSettingPort;

    const service = new UpsertProfessionalProfileService(
      profilesRepository,
      platformSettingPort,
    );

    return {
      service,
      profile,
      findExistingCategoryIds,
      upsertProfessionalProfile,
      findUsablePendingPhotoUploadRef,
      isEnabled,
    };
  }

  function validInput(
    overrides?: Partial<UpsertProfessionalProfileInput>,
  ): UpsertProfessionalProfileInput {
    return {
      firstName: 'Juan',
      lastName: 'Perez',
      specializations: [
        {
          categoryId: 'cat-1',
          role: SpecializationRole.PRIMARY,
          description: 'Plomero con 10 años de experiencia.',
          yearsOfExperience: 10,
        },
      ],
      city: 'CABA',
      serviceAreaDescription: 'CABA y GBA Norte',
      bio: 'Trabajo en el rubro hace mas de una decada.',
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

  it('creates with verificationStatus UNVERIFIED and returns the repository profile unchanged', async () => {
    const { service, profile } = makeService({ wasCreated: true });

    const result = await service.upsertProfessionalProfile(
      'user-1',
      validInput(),
    );

    expect(result).toBe(profile);
    expect(result.verificationStatus).toBe('UNVERIFIED');
  });

  it('defaults country to "AR" when omitted', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile('user-1', validInput());

    expect(upsertProfessionalProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ country: 'AR' }),
    );
  });

  it('resolves a usable photoUploadRef to photoUrl + photoUploadRefId; passes languages through', async () => {
    const {
      service,
      upsertProfessionalProfile,
      findUsablePendingPhotoUploadRef,
    } = makeService({
      usableRef: {
        id: 'ref-1',
        fileUrl: 'http://localhost:3000/uploads/pro.webp',
      },
    });

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({ photoUploadRef: 'ref-1', languages: ['es', 'en'] }),
    );

    expect(findUsablePendingPhotoUploadRef).toHaveBeenCalledWith(
      'user-1',
      'ref-1',
    );
    expect(upsertProfessionalProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        photoUrl: 'http://localhost:3000/uploads/pro.webp',
        photoUploadRefId: 'ref-1',
        languages: ['es', 'en'],
      }),
    );
  });

  it('rejects an unusable photoUploadRef with INVALID_PROFILE_PHOTO_UPLOAD_REF', async () => {
    const { service, upsertProfessionalProfile } = makeService({
      usableRef: null,
    });

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({ photoUploadRef: 'ref-x' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE_PHOTO_UPLOAD_REF' });
    expect(upsertProfessionalProfile).not.toHaveBeenCalled();
  });

  it('rejects a photoUploadRef when the feature toggle is off', async () => {
    const { service, upsertProfessionalProfile } = makeService({
      featureEnabled: false,
    });

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({ photoUploadRef: 'ref-1' }),
      ),
    ).rejects.toMatchObject({ code: 'PROFILE_PHOTO_UPLOAD_DISABLED' });
    expect(upsertProfessionalProfile).not.toHaveBeenCalled();
  });

  it('passes photoUrl/photoUploadRefId/languages through as undefined when no ref is submitted', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile('user-1', validInput());

    const callArg = (
      upsertProfessionalProfile.mock.calls as unknown[][]
    )[0][1] as {
      photoUrl?: string;
      photoUploadRefId?: string;
      languages?: string[];
    };
    expect(callArg.photoUrl).toBeUndefined();
    expect(callArg.photoUploadRefId).toBeUndefined();
    expect(callArg.languages).toBeUndefined();
  });

  it('passes locationSharingEnabled through to the repository when provided', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({ locationSharingEnabled: true }),
    );

    expect(upsertProfessionalProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ locationSharingEnabled: true }),
    );
  });

  it('passes locationSharingEnabled through as undefined (not a wipe/reset-to-false value) when omitted', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile('user-1', validInput());

    const callArg = (
      upsertProfessionalProfile.mock.calls as unknown[][]
    )[0][1] as {
      locationSharingEnabled?: boolean;
    };
    expect(callArg.locationSharingEnabled).toBeUndefined();
  });

  it('passes the optional displayName ("nombre comercial") through when provided', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({ displayName: 'Juan Perez - Plomería 24h' }),
    );

    expect(upsertProfessionalProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ displayName: 'Juan Perez - Plomería 24h' }),
    );
  });

  it('passes displayName through as undefined (leave unchanged) when omitted', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile('user-1', validInput());

    const callArg = (
      upsertProfessionalProfile.mock.calls as unknown[][]
    )[0][1] as { displayName?: string | null };
    expect(callArg.displayName).toBeUndefined();
  });

  it('passes an explicit null displayName through (clears the nombre comercial)', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({ displayName: null }),
    );

    const callArg = (
      upsertProfessionalProfile.mock.calls as unknown[][]
    )[0][1] as { displayName?: string | null };
    expect(callArg.displayName).toBeNull();
  });

  it('passes specializations through to the repository unchanged, in submission order', async () => {
    const { service, upsertProfessionalProfile } = makeService({
      existingCategoryIds: ['cat-1', 'cat-2'],
    });
    const specializations = [
      {
        categoryId: 'cat-1',
        role: SpecializationRole.PRIMARY,
        description: 'Electricista matriculado.',
        yearsOfExperience: 12,
      },
      {
        categoryId: 'cat-2',
        role: SpecializationRole.SECONDARY,
        description: 'Plomero ocasional.',
        yearsOfExperience: 2,
      },
    ];

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({ specializations }),
    );

    expect(upsertProfessionalProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ specializations }),
    );
  });

  it('throws PRIMARY_SPECIALIZATION_REQUIRED when zero specializations have role PRIMARY, and never calls upsert', async () => {
    const { service, upsertProfessionalProfile } = makeService();

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({
          specializations: [
            {
              categoryId: 'cat-1',
              role: SpecializationRole.SECONDARY,
              description: 'Solo secundaria.',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRIMARY_SPECIALIZATION_REQUIRED' });
    expect(upsertProfessionalProfile).not.toHaveBeenCalled();
  });

  it('throws PRIMARY_SPECIALIZATION_REQUIRED when two or more specializations have role PRIMARY', async () => {
    const { service, upsertProfessionalProfile } = makeService({
      existingCategoryIds: ['cat-1', 'cat-2'],
    });

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({
          specializations: [
            {
              categoryId: 'cat-1',
              role: SpecializationRole.PRIMARY,
              description: 'Principal 1.',
            },
            {
              categoryId: 'cat-2',
              role: SpecializationRole.PRIMARY,
              description: 'Principal 2.',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRIMARY_SPECIALIZATION_REQUIRED' });
    expect(upsertProfessionalProfile).not.toHaveBeenCalled();
  });

  it('PRIMARY_SPECIALIZATION_REQUIRED is a DomainException instance', async () => {
    const { service } = makeService();

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({
          specializations: [
            {
              categoryId: 'cat-1',
              role: SpecializationRole.SECONDARY,
              description: 'Solo secundaria.',
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('throws CATEGORY_NOT_FOUND when a submitted categoryId does not exist, and never calls upsert', async () => {
    const { service, upsertProfessionalProfile } = makeService({
      existingCategoryIds: [], // 'cat-1' submitted but not found to exist
    });

    await expect(
      service.upsertProfessionalProfile('user-1', validInput()),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    expect(upsertProfessionalProfile).not.toHaveBeenCalled();
  });

  it('CATEGORY_NOT_FOUND is a DomainException instance', async () => {
    const { service } = makeService({ existingCategoryIds: [] });

    await expect(
      service.upsertProfessionalProfile('user-1', validInput()),
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('rejects when only some submitted categoryIds exist (partial mismatch)', async () => {
    const { service } = makeService({ existingCategoryIds: ['cat-1'] });

    await expect(
      service.upsertProfessionalProfile(
        'user-1',
        validInput({
          specializations: [
            {
              categoryId: 'cat-1',
              role: SpecializationRole.PRIMARY,
              description: 'Principal.',
            },
            {
              categoryId: 'cat-missing',
              role: SpecializationRole.SECONDARY,
              description: 'Secundaria.',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('logs professional_profile_created on creation, not _updated', async () => {
    const { service } = makeService({ wasCreated: true });

    await service.upsertProfessionalProfile('user-1', validInput());

    const events = (logSpy.mock.calls as unknown[][]).map(
      (call) => (call[0] as { event: string }).event,
    );
    expect(events).toContain('professional_profile_created');
    expect(events).not.toContain('professional_profile_updated');
  });

  it('logs professional_profile_updated on an edit (second/idempotent call), not _created', async () => {
    const { service } = makeService({
      wasCreated: false,
      accountStatusTransitioned: false,
    });

    await service.upsertProfessionalProfile('user-1', validInput());

    const events = (logSpy.mock.calls as unknown[][]).map(
      (call) => (call[0] as { event: string }).event,
    );
    expect(events).toContain('professional_profile_updated');
    expect(events).not.toContain('professional_profile_created');
  });

  it('logs account_status_transition only when the repository reports the transition happened', async () => {
    const { service } = makeService({
      wasCreated: true,
      accountStatusTransitioned: true,
    });

    await service.upsertProfessionalProfile('user-1', validInput());

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'account_status_transition' }),
    );
  });

  it('never logs account_status_transition on an edit (second call)', async () => {
    const { service } = makeService({
      wasCreated: false,
      accountStatusTransitioned: false,
    });

    await service.upsertProfessionalProfile('user-1', validInput());

    const events = (logSpy.mock.calls as unknown[][]).map(
      (call) => (call[0] as { event: string }).event,
    );
    expect(events).not.toContain('account_status_transition');
  });

  it('logs specializationCount matching the repository result', async () => {
    const { service } = makeService({ wasCreated: true });

    await service.upsertProfessionalProfile('user-1', validInput());

    const createdLog = (logSpy.mock.calls as unknown[][])
      .map((call) => call[0] as { event: string; specializationCount?: number })
      .find((entry) => entry.event === 'professional_profile_created');
    expect(createdLog?.specializationCount).toBe(1);
  });

  it('never logs PII field values or the resolved photo URL', async () => {
    const { service } = makeService({
      usableRef: {
        id: 'ref-1',
        fileUrl: 'http://localhost:3000/uploads/secret-key.webp',
      },
    });

    await service.upsertProfessionalProfile(
      'user-1',
      validInput({
        displayName: 'Juan Perez - Plomería 24h',
        photoUploadRef: 'ref-1',
        languages: ['es', 'en'],
      }),
    );

    for (const call of logSpy.mock.calls as unknown[][]) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain('Juan');
      expect(payload).not.toContain('Perez');
      expect(payload).not.toContain('GBA Norte');
      expect(payload).not.toContain('experiencia');
      expect(payload).not.toContain('secret-key');
      expect(payload).not.toContain('"es"');
    }
  });

  it('validates categories before upserting (findExistingCategoryIds called first)', async () => {
    const { service, findExistingCategoryIds, upsertProfessionalProfile } =
      makeService();

    await service.upsertProfessionalProfile('user-1', validInput());

    expect(findExistingCategoryIds.mock.invocationCallOrder[0]).toBeLessThan(
      upsertProfessionalProfile.mock.invocationCallOrder[0],
    );
  });
});
