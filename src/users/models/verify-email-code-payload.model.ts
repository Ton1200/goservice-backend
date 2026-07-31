import { Field, ObjectType } from '@nestjs/graphql';
import { DomainError } from './domain-error.model';

@ObjectType()
export class VerifyEmailCodePayload {
  @Field()
  success!: boolean;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
