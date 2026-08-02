import { Field, ID, ObjectType } from '@nestjs/graphql';
import { DomainError } from '../../common/graphql/domain-error.model';

/**
 * `errors` is kept for SDL fidelity but never populated — `userId: ID!` is
 * non-null and cannot coexist with a partial failure payload, so hard
 * `login`/`socialLogin` failures are thrown as `DomainException` instead
 * (always the shared `authenticationFailed()` result — see
 * `src/auth/errors/authentication-failed.error.ts`). See the GOS-22
 * plan's "Decisiones y discrepancias" #2.
 *
 * `sessionToken`/`sessionExpiresAt` were added in GOS-7. `sessionExpiresAt`
 * deliberately reuses the calendar-only `Date` scalar already registered
 * for `RegisterInput.dateOfBirth` (see `common/graphql/date.scalar.ts`) per
 * the GOS-7 plan, rather than introducing a new `DateTime` scalar — this
 * truncates the time-of-day component of the expiry down to a calendar
 * date, a known, accepted trade-off for this story's scope (no UI consumes
 * this field precisely yet).
 */
@ObjectType()
export class LoginPayload {
  @Field(() => ID)
  userId!: string;

  @Field()
  sessionToken!: string;

  @Field(() => Date)
  sessionExpiresAt!: Date;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
