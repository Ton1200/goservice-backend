import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * Read-only service catalog entry. No GraphQL mutation ever creates,
 * updates, or deletes a `Category` — the catalog is seeded exclusively via
 * `prisma/seed.ts` (`npm run prisma:seed`). See `categories` query in
 * `profiles.resolver.ts`.
 */
@ObjectType()
export class Category {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
