import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class DeleteCategoryPayload {
  @Field()
  success!: boolean;
}
