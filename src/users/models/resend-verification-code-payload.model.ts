import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ResendVerificationCodePayload {
  @Field()
  resent!: boolean;

  @Field(() => GraphQLISODateTime)
  nextResendAvailableAt!: Date;
}
