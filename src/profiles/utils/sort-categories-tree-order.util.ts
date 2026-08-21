import { Category } from '@prisma/client';

/**
 * Re-orders a FLAT list of `Category` rows (already sorted per-sibling —
 * see `ProfilesRepository.findAllCategories`'s own
 * `orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }]`) into TREE PRE-ORDER:
 * every root category immediately followed by its own children (recursively,
 * each still in their own sibling order), before moving on to the next root.
 * Pure/in-memory — the catalog is small by design (see `Category`'s own
 * header comment), so there is no need for a recursive SQL CTE here.
 *
 * Used by every FLAT consumer of the catalog (`categories`,
 * `serviceRequestCategories`, `adminCategories`) so a plain `[Category!]!`
 * list still reads as a sensible, hierarchy-respecting order even without
 * rendering it as an actual tree — see `buildCategoryTree` (same file) for
 * the ADMIN panel's actual nested-tree shape.
 */
export function sortCategoriesInTreeOrder(categories: Category[]): Category[] {
  const childrenByParentId = groupByParentId(categories);
  const result: Category[] = [];

  const visit = (parentId: string | null): void => {
    for (const category of childrenByParentId.get(parentId) ?? []) {
      result.push(category);
      visit(category.id);
    }
  };
  visit(null);

  return result;
}

/**
 * Builds the ADMIN panel's actual nested tree shape (`CategoryTreeNode`) —
 * root categories at the top level, each carrying its own `children` array,
 * recursively. Same pre-sorted-siblings input contract as
 * `sortCategoriesInTreeOrder` above.
 */
export interface CategoryTreeNodeData {
  id: string;
  name: string;
  displayOrder: number;
  parentId: string | null;
  children: CategoryTreeNodeData[];
}

export function buildCategoryTree(
  categories: Category[],
): CategoryTreeNodeData[] {
  const childrenByParentId = groupByParentId(categories);

  const build = (parentId: string | null): CategoryTreeNodeData[] =>
    (childrenByParentId.get(parentId) ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      displayOrder: category.displayOrder,
      parentId: category.parentId,
      children: build(category.id),
    }));

  return build(null);
}

function groupByParentId(
  categories: Category[],
): Map<string | null, Category[]> {
  const map = new Map<string | null, Category[]>();
  for (const category of categories) {
    const key = category.parentId;
    const siblings = map.get(key) ?? [];
    siblings.push(category);
    map.set(key, siblings);
  }
  return map;
}
