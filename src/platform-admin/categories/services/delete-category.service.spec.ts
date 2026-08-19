import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { DeleteCategoryService } from './delete-category.service';

describe('DeleteCategoryService', () => {
  const existing = {
    id: 'cat-1',
    name: 'Cerrajería',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    existing?: unknown;
    serviceRequestCount?: number;
    specializationCount?: number;
    childCount?: number;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findCategoryByIdForAdmin = jest
      .fn()
      .mockResolvedValue(
        overrides?.existing === undefined ? existing : overrides.existing,
      );
    const countSpecializationsByCategoryId = jest
      .fn()
      .mockResolvedValue(overrides?.specializationCount ?? 0);
    const countChildCategories = jest
      .fn()
      .mockResolvedValue(overrides?.childCount ?? 0);
    const deleteCategoryForAdmin = jest.fn().mockResolvedValue(existing);
    const profilesRepository = {
      findCategoryByIdForAdmin,
      countSpecializationsByCategoryId,
      countChildCategories,
      deleteCategoryForAdmin,
    } as unknown as ProfilesRepository;

    const countByCategoryId = jest
      .fn()
      .mockResolvedValue(overrides?.serviceRequestCount ?? 0);
    const serviceRequestsRepository = {
      countByCategoryId,
    } as unknown as ServiceRequestsRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new DeleteCategoryService(
      prisma,
      profilesRepository,
      serviceRequestsRepository,
      auditLogRepository,
    );

    return {
      service,
      findCategoryByIdForAdmin,
      deleteCategoryForAdmin,
      write,
    };
  }

  it('deletes an unused Category and writes an AdminAuditLog row', async () => {
    const { service, deleteCategoryForAdmin, write } = makeService();

    const result = await service.deleteCategory('admin-1', existing.id);

    expect(deleteCategoryForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      existing.id,
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'CATEGORY_DELETED',
        targetType: 'Category',
        targetKey: existing.id,
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it('throws CATEGORY_NOT_FOUND when the target id does not exist', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.deleteCategory('admin-1', existing.id),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('throws CATEGORY_IN_USE when the Category still has child Categories', async () => {
    const { service, deleteCategoryForAdmin } = makeService({
      childCount: 2,
    });

    await expect(
      service.deleteCategory('admin-1', existing.id),
    ).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(deleteCategoryForAdmin).not.toHaveBeenCalled();
  });

  it('throws CATEGORY_IN_USE when the Category is still referenced by a ServiceRequest', async () => {
    const { service, deleteCategoryForAdmin } = makeService({
      serviceRequestCount: 1,
    });

    await expect(
      service.deleteCategory('admin-1', existing.id),
    ).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(deleteCategoryForAdmin).not.toHaveBeenCalled();
  });

  it('throws CATEGORY_IN_USE when the Category is still referenced by a ProfessionalSpecialization', async () => {
    const { service, deleteCategoryForAdmin } = makeService({
      specializationCount: 1,
    });

    await expect(
      service.deleteCategory('admin-1', existing.id),
    ).rejects.toMatchObject({ code: 'CATEGORY_IN_USE' });
    expect(deleteCategoryForAdmin).not.toHaveBeenCalled();
  });
});
