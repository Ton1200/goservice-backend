import { Field, ObjectType } from '@nestjs/graphql';
import { DomainError } from '../../../common/graphql/domain-error.model';

/**
 * Same dual-error shape as `ResetPasswordPayload`/`VerifyEmailCodePayload`.
 * NO `sessionToken`/`adminUserId` field here — mirrors `RegisterPayload`'s
 * own shape (also no session field): a successful `acceptAdminInvite`
 * activates the account and sets its password, but issues no session — the
 * new admin does a normal, separate `adminLogin` afterward.
 */
@ObjectType()
export class AcceptAdminInvitePayload {
  @Field()
  success!: boolean;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
