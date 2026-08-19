import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { UpdateCategoryService } from './update-category.service';

describe('UpdateCategoryService', () => {
  const existing = {
    id: 'cat-1',
    name: 'Electricidad',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const otherParent = {
    id: 'cat-parent',
    name: 'Servicios del hogar',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    existing?: unknown;
    duplicate?: unknown;
    parent?: unknown;
    descendantIds?: string[];
    updated?: unknown;
  }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findCategoryByIdForAdmin = jest
      .fn()
      .mockImplementation((id: string) => {
        if (overrides?.existing !== undefined && id === existing.id) {
          return Promise.resolve(overrides.existing);
        }
        if (id === existing.id) {
          return Promise.resolve(existing);
        }
        if (overrides?.parent !== undefined) {
          return Promise.resolve(overrides.parent);
        }
        return Promise.resolve(otherParent);
      });
    const findCategoryByNameForAdmin = jest
      .fn()
      .mockResolvedValue(
        overrides?.duplicate === undefined ? null : overrides.duplicate,
      );
    const findDescendantCategoryIds = jest
      .fn()
      .mockResolvedValue(overrides?.descendantIds ?? [existing.id]);
    const updatedRow = overrides?.updated ?? {
      ...existing,
      name: 'Electricidad y Gas',
    };
    const updateCategoryForAdmin = jest.fn().mockResolvedValue(updatedRow);
    const profilesRepository = {
      findCategoryByIdForAdmin,
      findCategoryByNameForAdmin,
      findDescendantCategoryIds,
      updateCategoryForAdmin,
    } as unknown as ProfilesRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new UpdateCategoryService(
      prisma,
      profilesRepository,
      auditLogRepository,
    );

    return {
      service,
      findCategoryByIdForAdmin,
      findCategoryByNameForAdmin,
      findDescendantCategoryIds,
      updateCategoryForAdmin,
      write,
      updatedRow,
    };
  }

  it('renames a Category and writes an AdminAuditLog row', async () => {
    const { service, updateCategoryForAdmin, write, updatedRow } =
      makeService();

    const result = await service.updateCategory('admin-1', existing.id, {
      name: 'Electricidad y Gas',
    });

    expect(updateCategoryForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      existing.id,
      expect.objectContaining({ name: 'Electricidad y Gas' }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'CATEGORY_UPDATED',
        targetType: 'Category',
        targetKey: existing.id,
      }),
    );
    expect(result).toBe(updatedRow);
  });

  it('re-parents a Category when the new parent exists and is not a descendant', async () => {
    const { service, updateCategoryForAdmin } = makeService();

    await service.updateCategory('admin-1', existing.id, {
      parentId: 'cat-parent',
    });

    expect(updateCategoryForAdmin).toHaveBeenCalledWith(
      expect.anything(),
      existing.id,
      expect.objectContaining({ parentId: 'cat-parent' }),
    );
  });

  it('clears the parent (moves to root) when parentId is explicitly null', async () => {
    const { service, updateCategoryForAdmin } = makeService({
      existing: { ...existing, parentId: 'cat-parent' },
    });

    await service.updateCategory('admin-1', existing.id, {
      parentId: null,
    });

    expect(updateCategoryForAdmin).toHaveBeenCalledWith(
      expect.anything(),
      existing.id,
      expect.objectContaining({ parentId: null }),
    );
  });

  it('is a no-op (no write, no audit row) when nothing actually changes', async () => {
    const { service, updateCategoryForAdmin, write } = makeService();

    const result = await service.updateCategory('admin-1', existing.id, {
      name: existing.name,
    });

    expect(updateCategoryForAdmin).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('throws CATEGORY_NOT_FOUND when the target id does not exist', async () => {
    const { service } = makeService({ existing: null });

    await expect(
      service.updateCategory('admin-1', existing.id, {
        name: 'Nuevo',
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
  });

  it('throws CATEGORY_NAME_TAKEN for a case-insensitive duplicate held by ANOTHER Category', async () => {
    const { service } = makeService({
      duplicate: { id: 'cat-other', name: 'plomería' },
    });

    await expect(
      service.updateCategory('admin-1', existing.id, {
        name: 'Plomería',
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NAME_TAKEN' });
  });

  it('does NOT throw CATEGORY_NAME_TAKEN when the case-insensitive "duplicate" found is the Category itself', async () => {
    const { service, updateCategoryForAdmin } = makeService({
      duplicate: { id: existing.id, name: 'electricidad' },
    });

    // Differs from `existing.name` only by casing, so the rename check
    // actually runs (and the case-insensitive lookup finds ITSELF).
    await service.updateCategory('admin-1', existing.id, {
      name: 'ELECTRICIDAD',
    });

    // Resolved to itself — not a real rename collision — so the write
    // still goes through.
    expect(updateCategoryForAdmin).toHaveBeenCalledWith(
      expect.anything(),
      existing.id,
      expect.objectContaining({ name: 'ELECTRICIDAD' }),
    );
  });

  it("throws CATEGORY_PARENT_CYCLE when parentId is set to the Category's own id", async () => {
    const { service, updateCategoryForAdmin } = makeService();

    await expect(
      service.updateCategory('admin-1', existing.id, {
        parentId: existing.id,
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_PARENT_CYCLE' });
    expect(updateCategoryForAdmin).not.toHaveBeenCalled();
  });

  it("throws CATEGORY_PARENT_CYCLE when parentId is one of the Category's own descendants", async () => {
    const { service, updateCategoryForAdmin } = makeService({
      descendantIds: [existing.id, 'cat-child'],
      parent: { id: 'cat-child', name: 'Sub-electricidad' },
    });

    await expect(
      service.updateCategory('admin-1', existing.id, {
        parentId: 'cat-child',
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_PARENT_CYCLE' });
    expect(updateCategoryForAdmin).not.toHaveBeenCalled();
  });

  it('throws CATEGORY_NOT_FOUND when the new parentId does not resolve to an existing Category', async () => {
    const { service, updateCategoryForAdmin } = makeService({
      parent: null,
    });

    await expect(
      service.updateCategory('admin-1', existing.id, {
        parentId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    expect(updateCategoryForAdmin).not.toHaveBeenCalled();
  });
});
