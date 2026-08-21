import { Category } from '@prisma/client';
import {
  buildCategoryTree,
  sortCategoriesInTreeOrder,
} from './sort-categories-tree-order.util';

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: 'id',
    name: 'name',
    displayOrder: 0,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('sortCategoriesInTreeOrder', () => {
  it('interleaves each root with its own children before the next root', () => {
    const rootA = makeCategory({ id: 'root-a', name: 'Electricidad' });
    const rootB = makeCategory({ id: 'root-b', name: 'Plomería' });
    const childOfA = makeCategory({
      id: 'child-a1',
      name: 'Instalaciones',
      parentId: 'root-a',
    });
    const childOfB = makeCategory({
      id: 'child-b1',
      name: 'Reparaciones',
      parentId: 'root-b',
    });

    // Realistic DB shape: the query sorts the WHOLE result set by
    // `[displayOrder, name]` (not per-parent), so a child commonly does
    // NOT sit immediately after its own parent in the raw flat list — here
    // both roots happen to sort before either child. Root-level relative
    // order (root-a before root-b) and each parent's own children are
    // already correctly pre-sorted by the DB query; this only tests that
    // the function correctly RE-INTERLEAVES a child that isn't already
    // adjacent to its parent in the input.
    const result = sortCategoriesInTreeOrder([
      rootA,
      rootB,
      childOfB,
      childOfA,
    ]);

    expect(result.map((c) => c.id)).toEqual([
      'root-a',
      'child-a1',
      'root-b',
      'child-b1',
    ]);
  });

  it('preserves the pre-sorted sibling order at every level (does not re-sort)', () => {
    const first = makeCategory({ id: 'a', displayOrder: 0 });
    const second = makeCategory({ id: 'b', displayOrder: 1 });

    const result = sortCategoriesInTreeOrder([first, second]);

    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('handles a grandchild (3 levels deep)', () => {
    const root = makeCategory({ id: 'root' });
    const child = makeCategory({ id: 'child', parentId: 'root' });
    const grandchild = makeCategory({ id: 'grandchild', parentId: 'child' });

    const result = sortCategoriesInTreeOrder([grandchild, root, child]);

    expect(result.map((c) => c.id)).toEqual(['root', 'child', 'grandchild']);
  });

  it('returns an empty array for an empty input', () => {
    expect(sortCategoriesInTreeOrder([])).toEqual([]);
  });
});

describe('buildCategoryTree', () => {
  it('nests children under their parent, recursively', () => {
    const root = makeCategory({ id: 'root', name: 'Electricidad' });
    const child = makeCategory({
      id: 'child',
      name: 'Instalaciones',
      parentId: 'root',
    });
    const grandchild = makeCategory({
      id: 'grandchild',
      name: 'Domiciliarias',
      parentId: 'child',
    });

    const tree = buildCategoryTree([root, child, grandchild]);

    expect(tree).toEqual([
      {
        id: 'root',
        name: 'Electricidad',
        displayOrder: 0,
        parentId: null,
        children: [
          {
            id: 'child',
            name: 'Instalaciones',
            displayOrder: 0,
            parentId: 'root',
            children: [
              {
                id: 'grandchild',
                name: 'Domiciliarias',
                displayOrder: 0,
                parentId: 'child',
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('returns multiple root nodes for multiple roots', () => {
    const rootA = makeCategory({ id: 'root-a' });
    const rootB = makeCategory({ id: 'root-b' });

    const tree = buildCategoryTree([rootA, rootB]);

    expect(tree.map((n) => n.id)).toEqual(['root-a', 'root-b']);
    expect(tree[0].children).toEqual([]);
    expect(tree[1].children).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });
});
