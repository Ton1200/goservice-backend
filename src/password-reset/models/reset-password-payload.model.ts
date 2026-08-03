import { Field, ObjectType } from '@nestjs/graphql';
import { DomainError } from '../../common/graphql/domain-error.model';

/** Same dual-error shape as `VerifyEmailCodePayload` — see that model. */
@ObjectType()
export class ResetPasswordPayload {
  @Field()
  success!: boolean;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
