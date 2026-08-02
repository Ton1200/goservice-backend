import { Field, ObjectType } from '@nestjs/graphql';
import { DomainError } from '../../common/graphql/domain-error.model';

@ObjectType()
export class VerifyEmailCodePayload {
  @Field()
  success!: boolean;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
