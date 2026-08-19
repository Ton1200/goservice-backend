import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import { CreateCategoryInput } from '../models/create-category.input';
import { CreateCategoryService } from './create-category.service';

describe('CreateCategoryService', () => {
  const createdRow = {
    id: 'cat-new',
    name: 'Cerrajería',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const existingParent = {
    id: 'cat-parent',
    name: 'Electricidad',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: { duplicate?: unknown; parent?: unknown }) {
    const fakeTx = { __fakeTransactionClient: true };
    const $transaction = jest.fn(
      (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    const prisma = { $transaction } as unknown as PrismaService;

    const findCategoryByNameForAdmin = jest
      .fn()
      .mockResolvedValue(
        overrides?.duplicate === undefined ? null : overrides.duplicate,
      );
    const findCategoryByIdForAdmin = jest
      .fn()
      .mockResolvedValue(
        overrides?.parent === undefined ? existingParent : overrides.parent,
      );
    const createCategoryForAdmin = jest.fn().mockResolvedValue(createdRow);
    const profilesRepository = {
      findCategoryByNameForAdmin,
      findCategoryByIdForAdmin,
      createCategoryForAdmin,
    } as unknown as ProfilesRepository;

    const write = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const auditLogRepository = { write } as unknown as AuditLogRepository;

    const service = new CreateCategoryService(
      prisma,
      profilesRepository,
      auditLogRepository,
    );

    return {
      service,
      findCategoryByNameForAdmin,
      findCategoryByIdForAdmin,
      createCategoryForAdmin,
      write,
    };
  }

  function validInput(
    overrides?: Partial<CreateCategoryInput>,
  ): CreateCategoryInput {
    return { name: 'Cerrajería', ...overrides };
  }

  it('creates a root Category (no parentId) with displayOrder defaulted to 0', async () => {
    const { service, createCategoryForAdmin, write } = makeService();

    const result = await service.createCategory('admin-1', validInput());

    expect(createCategoryForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      { name: 'Cerrajería', displayOrder: 0, parentId: null },
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTransactionClient: true }),
      expect.objectContaining({
        actorAdminUserId: 'admin-1',
        action: 'CATEGORY_CREATED',
        targetType: 'Category',
        targetKey: createdRow.id,
      }),
    );
    expect(result).toBe(createdRow);
  });

  it('creates a child Category when parentId resolves to an existing Category', async () => {
    const { service, createCategoryForAdmin } = makeService();

    await service.createCategory(
      'admin-1',
      validInput({ parentId: 'cat-parent', displayOrder: 3 }),
    );

    expect(createCategoryForAdmin).toHaveBeenCalledWith(expect.anything(), {
      name: 'Cerrajería',
      displayOrder: 3,
      parentId: 'cat-parent',
    });
  });

  it('trims the submitted name before checking/creating', async () => {
    const { service, findCategoryByNameForAdmin, createCategoryForAdmin } =
      makeService();

    await service.createCategory(
      'admin-1',
      validInput({ name: '  Cerrajería  ' }),
    );

    expect(findCategoryByNameForAdmin).toHaveBeenCalledWith('Cerrajería');
    expect(createCategoryForAdmin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Cerrajería' }),
    );
  });

  it('throws CATEGORY_NAME_TAKEN for a case-insensitive duplicate name', async () => {
    const { service, createCategoryForAdmin } = makeService({
      duplicate: { id: 'cat-existing', name: 'cerrajería' },
    });

    await expect(
      service.createCategory('admin-1', validInput()),
    ).rejects.toMatchObject({ code: 'CATEGORY_NAME_TAKEN' });
    expect(createCategoryForAdmin).not.toHaveBeenCalled();
  });

  it('throws CATEGORY_NOT_FOUND when parentId does not resolve to an existing Category', async () => {
    const { service, createCategoryForAdmin } = makeService({
      parent: null,
    });

    await expect(
      service.createCategory('admin-1', validInput({ parentId: 'missing' })),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    expect(createCategoryForAdmin).not.toHaveBeenCalled();
  });
});
