import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { CurrentAdminUser } from '../admin-auth/decorators/current-admin-user.decorator';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { Category } from '../../profiles/models/category.model';
import { CreateCategoryService } from './services/create-category.service';
import { DeleteCategoryService } from './services/delete-category.service';
import { ListAdminCategoriesService } from './services/list-admin-categories.service';
import { ListAdminCategoryTreeService } from './services/list-admin-category-tree.service';
import { UpdateCategoryService } from './services/update-category.service';
import { CategoryTreeNode } from './models/category-tree-node.model';
import { CreateCategoryInput } from './models/create-category.input';
import { DeleteCategoryPayload } from './models/delete-category-payload.model';
import { UpdateCategoryInput } from './models/update-category.input';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `adminCategories`/`adminCategoryTree` require `CATEGORIES_READ`;
 * `createCategory`/`updateCategory`/`deleteCategory` require
 * `CATEGORIES_WRITE`. Named distinctly from the consumer schema's own
 * `categories` query and from this same admin schema's
 * `serviceRequestCategories` (a different, narrower query) so none of the
 * three ever collide in the admin-schema-isolation suite's field-name
 * checks.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminCategoriesResolver {
  constructor(
    private readonly listAdminCategoriesService: ListAdminCategoriesService,
    private readonly listAdminCategoryTreeService: ListAdminCategoryTreeService,
    private readonly createCategoryService: CreateCategoryService,
    private readonly updateCategoryService: UpdateCategoryService,
    private readonly deleteCategoryService: DeleteCategoryService,
  ) {}

  @RequireAdminPermissions(Permission.CATEGORIES_READ)
  @Query(() => [Category], {
    description:
      "The full Category catalog, flat and tree-pre-ordered (every root immediately followed by its own descendants). See adminCategoryTree for the nested-tree shape used by the admin panel's tree view.",
  })
  adminCategories(): Promise<Category[]> {
    return this.listAdminCategoriesService.listCategories();
  }

  @RequireAdminPermissions(Permission.CATEGORIES_READ)
  @Query(() => [CategoryTreeNode], {
    description:
      "The Category catalog as an actual nested tree (root categories, each with a recursive children array) — powers the admin panel's tree view.",
  })
  adminCategoryTree(): Promise<CategoryTreeNode[]> {
    return this.listAdminCategoryTreeService.listCategoryTree();
  }

  @RequireAdminPermissions(Permission.CATEGORIES_WRITE)
  @Mutation(() => Category, {
    description:
      'Creates a new Category. Rejects a case-insensitive duplicate name (CATEGORY_NAME_TAKEN). parentId, if given, must reference an existing Category (CATEGORY_NOT_FOUND) — omitted/null creates a root-level Category. Writes an AdminAuditLog row in the same transaction.',
  })
  createCategory(
    @CurrentAdminUser() adminUserId: string,
    @Args('input') input: CreateCategoryInput,
  ): Promise<Category> {
    return this.createCategoryService.createCategory(adminUserId, input);
  }

  @RequireAdminPermissions(Permission.CATEGORIES_WRITE)
  @Mutation(() => Category, {
    description:
      'Partially updates a Category (only fields present in the input are changed). Re-parenting (parentId) is re-validated server-side: the target must exist and must not create a cycle (CATEGORY_PARENT_CYCLE). Writes an AdminAuditLog row in the same transaction, and is a true no-op (no write, no audit row) when nothing actually changes.',
  })
  updateCategory(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCategoryInput,
  ): Promise<Category> {
    return this.updateCategoryService.updateCategory(adminUserId, id, input);
  }

  @RequireAdminPermissions(Permission.CATEGORIES_WRITE)
  @Mutation(() => DeleteCategoryPayload, {
    description:
      'Permanently deletes a Category. Blocked with CATEGORY_IN_USE if it still has any child Category, ServiceRequest, or ProfessionalSpecialization referencing it — re-parent/delete children or wait until nothing references it first. Writes an AdminAuditLog row in the same transaction.',
  })
  deleteCategory(
    @CurrentAdminUser() adminUserId: string,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<DeleteCategoryPayload> {
    return this.deleteCategoryService.deleteCategory(adminUserId, id);
  }
}
