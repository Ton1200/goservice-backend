import { Field, ObjectType } from '@nestjs/graphql';

/** Mirrors `DeleteCategoryPayload`/`DeleteAdminRolePayload`'s exact shape. */
@ObjectType()
export class DeleteAdminUserPayload {
  @Field()
  success!: boolean;
}
