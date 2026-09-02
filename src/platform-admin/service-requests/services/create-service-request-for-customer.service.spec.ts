import { Logger } from '@nestjs/common';
import { ServiceRequestUrgency, UserAccountStatus } from '@prisma/client';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { UsersRepository } from '../../../users/users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { AdminCreateServiceRequestInput } from '../models/admin-create-service-request-input.model';
import { CreateServiceRequestForCustomerService } from './create-service-request-for-customer.service';

describe('CreateServiceRequestForCustomerService', () => {
  const customerProfile = { id: 'customer-profile-1', userId: 'user-1' };
  const createdRow = {
    id: 'service-request-1',
    description: 'Se rompió una cañería.',
    urgency: ServiceRequestUrgency.URGENT,
    indicativeBudgetMin: null,
    indicativeBudgetMax: null,
    status: 'OPEN',
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: {
      id: 'cat-1',
      name: 'Plomería',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    customerProfile: {
      id: customerProfile.id,
      firstName: 'Juan',
      lastName: 'Perez',
      user: {
        id: 'user-1',
        email: 'juan@example.com',
      },
    },
    _count: { attachments: 0 },
  };

  function makeService(overrides?: {
    accountStatus?: UserAccountStatus | null;
    customerProfile?: typeof customerProfile | null;
    existingCategoryIds?: string[];
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findAccountStatusById = jest
      .fn()
      .mockResolvedValue(
        overrides?.accountStatus === undefined
          ? UserAccountStatus.APPROVED
          : overrides.accountStatus,
      );
    const usersRepository = {
      findAccountStatusById,
    } as unknown as UsersRepository;

    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? customerProfile
          : overrides.customerProfile,
      );
    const findExistingCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.existingCategoryIds ?? ['cat-1']);
    const profilesRepository = {
      findCustomerProfileByUserId,
      findExistingCategoryIds,
    } as unknown as ProfilesRepository;

    const createForAdmin = jest.fn().mockResolvedValue(createdRow);
    const serviceRequestsRepository = {
      createForAdmin,
    } as unknown as ServiceRequestsRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new CreateServiceRequestForCustomerService(
      prisma,
      usersRepository,
      profilesRepository,
      serviceRequestsRepository,
      auditLogRepository,
    );

    return {
      service,
      findAccountStatusById,
      findCustomerProfileByUserId,
      findExistingCategoryIds,
      createForAdmin,
      write,
    };
  }

  function validInput(
    overrides?: Partial<AdminCreateServiceRequestInput>,
  ): AdminCreateServiceRequestInput {
    return {
      userId: 'user-1',
      category: 'cat-1',
      description: 'Se rompió una cañería.',
      urgency: ServiceRequestUrgency.URGENT,
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

  it('creates a ServiceRequest for an APPROVED customer and writes an AdminAuditLog row', async () => {
    const { service, createForAdmin, write } = makeService();

    const result = await service.createServiceRequestForCustomer(
      'admin-1',
      validInput(),
    );

    expect(createForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({ customerProfileId: customerProfile.id }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'SERVICE_REQUEST_CREATED_BY_ADMIN',
        targetType: 'ServiceRequest',
        targetKey: createdRow.id,
      }),
    );
    expect(result.id).toBe(createdRow.id);
  });

  it('throws USER_ACCOUNT_NOT_FOUND when the target user does not exist', async () => {
    const { service } = makeService({ accountStatus: null });

    await expect(
      service.createServiceRequestForCustomer('admin-1', validInput()),
    ).rejects.toMatchObject({ code: 'USER_ACCOUNT_NOT_FOUND' });
  });

  it('throws ACCOUNT_NOT_APPROVED when the target user is not APPROVED', async () => {
    const { service } = makeService({
      accountStatus: UserAccountStatus.PENDING_APPROVAL,
    });

    await expect(
      service.createServiceRequestForCustomer('admin-1', validInput()),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_APPROVED' });
  });

  it('throws CUSTOMER_PROFILE_REQUIRED when the target user has no CustomerProfile', async () => {
    const { service } = makeService({ customerProfile: null });

    await expect(
      service.createServiceRequestForCustomer('admin-1', validInput()),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PROFILE_REQUIRED' });
  });

  it('throws CATEGORY_NOT_FOUND for a nonexistent category', async () => {
    const { service } = makeService({ existingCategoryIds: [] });

    await expect(
      service.createServiceRequestForCustomer('admin-1', validInput()),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('throws INVALID_SERVICE_REQUEST_BUDGET_RANGE when min > max', async () => {
    const { service } = makeService();

    await expect(
      service.createServiceRequestForCustomer(
        'admin-1',
        validInput({ indicativeBudgetMin: 500, indicativeBudgetMax: 100 }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_REQUEST_BUDGET_RANGE' });
  });

  it('never creates anything when a validation fails before the transaction', async () => {
    const { service, createForAdmin } = makeService({
      accountStatus: UserAccountStatus.PENDING_APPROVAL,
    });

    await expect(
      service.createServiceRequestForCustomer('admin-1', validInput()),
    ).rejects.toBeDefined();
    expect(createForAdmin).not.toHaveBeenCalled();
  });
});
