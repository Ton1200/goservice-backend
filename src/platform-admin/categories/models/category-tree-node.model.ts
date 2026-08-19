import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * The admin panel's nested-tree shape for `adminCategoryTree` — root
 * Categories at the top level, each carrying its own `children` array,
 * recursively. Self-referencing `@ObjectType()` (a legal, common code-first
 * pattern — same idea as a comment-thread type), safe to reference itself
 * inside its own `@Field(() => [CategoryTreeNode])` thunk since
 * `@nestjs/graphql` only evaluates that thunk lazily, during schema
 * building, well after this class is fully defined.
 *
 * A DIFFERENT shape from the shared `Category` type (`src/profiles/models/`)
 * used by every FLAT list (`categories`/`serviceRequestCategories`/
 * `adminCategories`) — this one exists purely to save the admin panel from
 * re-building a tree client-side out of a flat `parentId`-linked list.
 * Admin-only: never reachable from the public `/graphql` schema.
 */
@ObjectType()
export class CategoryTreeNode {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  displayOrder!: number;

  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => [CategoryTreeNode])
  children!: CategoryTreeNode[];
}
