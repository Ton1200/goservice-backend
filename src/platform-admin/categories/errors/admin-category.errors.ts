import { DomainException } from '../../../common/errors/domain-exception';

/**
 * Same `CATEGORY_NOT_FOUND` code every OTHER "categoryId doesn't exist"
 * case in this codebase already throws (`PublishServiceRequestService`,
 * `UpsertProfessionalProfileService`, `CreateServiceRequestForCustomerService`)
 * — reused, not duplicated under a new name. Used here for THREE distinct
 * admin call sites: `updateCategory`/`deleteCategory` targeting a
 * nonexistent `id`, and `createCategory`/`updateCategory` targeting a
 * nonexistent `parentId`.
 */
export function categoryNotFound(id: string): DomainException {
  return new DomainException(
    'CATEGORY_NOT_FOUND',
    `No Category exists with id "${id}".`,
  );
}

/**
 * `Category.name` is `@unique` at the DB level (case-SENSITIVE there), but
 * `ProfilesRepository.findCategoryByNameForAdmin` pre-checks
 * case-INSENSITIVELY — "Plomería" and "plomería" are treated as the same
 * name here, a deliberately stricter rule than the raw DB constraint would
 * enforce on its own (avoids two near-identical catalog entries differing
 * only by casing).
 */
export function categoryNameTaken(name: string): DomainException {
  return new DomainException(
    'CATEGORY_NAME_TAKEN',
    `A Category named "${name}" already exists.`,
  );
}

/**
 * Thrown by `DeleteCategoryService` for any of THREE reasons, all
 * collapsed under one code (the caller doesn't need to distinguish them
 * programmatically — the admin panel shows this message verbatim):
 * the Category still has at least one ServiceRequest, one
 * ProfessionalSpecialization, or one CHILD Category referencing it.
 */
export function categoryInUse(reason: string): DomainException {
  return new DomainException(
    'CATEGORY_IN_USE',
    `This Category cannot be deleted: ${reason}.`,
  );
}

/**
 * Thrown by `UpdateCategoryService` when the submitted `parentId` would
 * make a Category its own ancestor (directly, by setting `parentId` to its
 * own `id`, or transitively, by setting it to any of its own descendants) —
 * see `ProfilesRepository.findDescendantCategoryIds`.
 */
export function categoryParentCycle(id: string): DomainException {
  return new DomainException(
    'CATEGORY_PARENT_CYCLE',
    `Category "${id}" cannot become its own descendant's child — this would create a cycle.`,
  );
}
