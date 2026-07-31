import { Field, ID, ObjectType } from '@nestjs/graphql';
import { DomainError } from './domain-error.model';

/**
 * `errors` is kept for SDL fidelity but never populated — `userId: ID!` is
 * non-null and cannot coexist with a partial failure payload, so hard
 * `socialLogin` failures are thrown as `DomainException` instead. See the
 * GOS-22 plan's "Decisiones y discrepancias" #2.
 */
@ObjectType()
export class LoginPayload {
  @Field(() => ID)
  userId!: string;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
