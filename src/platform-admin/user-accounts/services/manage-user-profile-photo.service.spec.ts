import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { GetUserAccountDetailService } from './get-user-account-detail.service';
import { ManageUserProfilePhotoService } from './manage-user-profile-photo.service';
import { AdminProfileKind } from '../models/admin-profile-kind.enum';

const OWN_URL = `http://localhost:3000/uploads/${'a'.repeat(32)}.webp`;

describe('ManageUserProfilePhotoService', () => {
  function makeService(overrides?: {
    userExists?: boolean;
    customerProfile?: unknown;
    professionalExists?: boolean;
  }) {
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        overrides?.userExists === false ? null : { id: 'user-1' },
      );
    const setCustomerProfilePhoto = jest.fn().mockResolvedValue({});
    const setProfessionalProfilePhoto = jest.fn().mockResolvedValue({});
    const auditWrite = jest.fn().mockResolvedValue(undefined);
    const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb({}));

    const prisma = {
      user: { findUnique },
      $transaction,
    } as unknown as PrismaService;
    const profilesRepository = {
      findCustomerProfileByUserId: jest
        .fn()
        .mockResolvedValue(
          overrides?.customerProfile === undefined
            ? { id: 'cp-1' }
            : overrides.customerProfile,
        ),
      professionalProfileExists: jest
        .fn()
        .mockResolvedValue(overrides?.professionalExists ?? true),
      setCustomerProfilePhoto,
      setProfessionalProfilePhoto,
    } as unknown as ProfilesRepository;
    const auditLogRepository = {
      write: auditWrite,
    } as unknown as AuditLogRepository;
    const getUserAccountDetailService = {
      getUserAccountDetail: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as GetUserAccountDetailService;
    const configService = {
      get: jest.fn().mockReturnValue({ baseUrl: 'http://localhost:3000' }),
    } as unknown as ConfigService<AppConfig, true>;

    const service = new ManageUserProfilePhotoService(
      prisma,
      profilesRepository,
      auditLogRepository,
      getUserAccountDetailService,
      configService,
    );
    return {
      service,
      setCustomerProfilePhoto,
      setProfessionalProfilePhoto,
      auditWrite,
    };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('setUserProfilePhoto rejects a URL not from our storage', async () => {
    const { service, setCustomerProfilePhoto } = makeService();
    await expect(
      service.setUserProfilePhoto('admin-1', {
        userId: 'user-1',
        profileKind: AdminProfileKind.CUSTOMER,
        photoUrl: 'https://evil.example.com/pic.webp',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE_PHOTO_URL' });
    expect(setCustomerProfilePhoto).not.toHaveBeenCalled();
  });

  it('setUserProfilePhoto rejects a non-.webp storage URL', async () => {
    const { service } = makeService();
    await expect(
      service.setUserProfilePhoto('admin-1', {
        userId: 'user-1',
        profileKind: AdminProfileKind.CUSTOMER,
        photoUrl: 'http://localhost:3000/uploads/abc.png',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE_PHOTO_URL' });
  });

  it('setUserProfilePhoto accepts a URL with a double slash (base URL ended with /)', async () => {
    const { service, setCustomerProfilePhoto } = makeService();
    const doubleSlash = `http://localhost:3000//uploads/${'a'.repeat(32)}.webp`;
    await service.setUserProfilePhoto('admin-1', {
      userId: 'user-1',
      profileKind: AdminProfileKind.CUSTOMER,
      photoUrl: doubleSlash,
    });
    expect(setCustomerProfilePhoto).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      doubleSlash,
    );
  });

  it('setUserProfilePhoto sets the customer photo + writes an audit row in one tx', async () => {
    const { service, setCustomerProfilePhoto, auditWrite } = makeService();
    await service.setUserProfilePhoto('admin-1', {
      userId: 'user-1',
      profileKind: AdminProfileKind.CUSTOMER,
      photoUrl: OWN_URL,
    });
    expect(setCustomerProfilePhoto).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      OWN_URL,
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'USER_PROFILE_PHOTO_SET' }),
    );
  });

  it('setUserProfilePhoto throws CUSTOMER_PROFILE_NOT_FOUND when absent', async () => {
    const { service } = makeService({ customerProfile: null });
    await expect(
      service.setUserProfilePhoto('admin-1', {
        userId: 'user-1',
        profileKind: AdminProfileKind.CUSTOMER,
        photoUrl: OWN_URL,
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_NOT_FOUND' });
  });

  it('setUserProfilePhoto throws PROFESSIONAL_PROFILE_NOT_FOUND when absent', async () => {
    const { service } = makeService({ professionalExists: false });
    await expect(
      service.setUserProfilePhoto('admin-1', {
        userId: 'user-1',
        profileKind: AdminProfileKind.PROFESSIONAL,
        photoUrl: OWN_URL,
      }),
    ).rejects.toMatchObject({ code: 'PROFESSIONAL_PROFILE_NOT_FOUND' });
  });

  it('setUserProfilePhoto throws USER_ACCOUNT_NOT_FOUND when the user is gone', async () => {
    const { service } = makeService({ userExists: false });
    await expect(
      service.setUserProfilePhoto('admin-1', {
        userId: 'user-x',
        profileKind: AdminProfileKind.CUSTOMER,
        photoUrl: OWN_URL,
      }),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_NOT_FOUND' });
  });

  it('removeUserProfilePhoto sets photoUrl null + audits USER_PROFILE_PHOTO_REMOVED', async () => {
    const { service, setProfessionalProfilePhoto, auditWrite } = makeService();
    await service.removeUserProfilePhoto('admin-1', {
      userId: 'user-1',
      profileKind: AdminProfileKind.PROFESSIONAL,
    });
    expect(setProfessionalProfilePhoto).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      null,
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'USER_PROFILE_PHOTO_REMOVED' }),
    );
  });
});
