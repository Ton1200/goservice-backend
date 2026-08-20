import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class DeleteAdminRolePayload {
  @Field()
  success!: boolean;
}
