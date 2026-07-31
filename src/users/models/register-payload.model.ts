import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class RegisterPayload {
  @Field(() => ID)
  userId!: string;

  @Field()
  emailVerificationRequired!: boolean;
}
