import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

/**
 * Service catalog entry. Originally read-only/seed-only (`prisma/seed.ts`,
 * `npm run prisma:seed`) — that remains how the catalog is FIRST populated,
 * but an admin can now create/rename/reorder/re-parent/delete entries too
 * (category-tree follow-up, 2026-08-18; see
 * `src/platform-admin/categories/`). `displayOrder`/`parentId` together
 * define the tree: `parentId: null` is a root category, and siblings
 * (Categories sharing the same `parentId`) are always ordered
 * `[{ displayOrder: 'asc' }, { name: 'asc' }]` — see `categories` query in
 * `profiles.resolver.ts` and `ProfilesRepository.findAllCategories`.
 */
@ObjectType()
export class Category {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  displayOrder!: number;

  // `null` = root-level category (no parent). Exposed here (not just on the
  // admin-only CategoryTreeNode) so any flat consumer of this shared type —
  // public `categories`, admin `serviceRequestCategories` — can indent/group
  // by parent client-side if it chooses to; nothing requires it to.
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
