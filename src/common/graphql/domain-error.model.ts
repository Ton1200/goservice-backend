import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Kept in the schema for fidelity to the confirmed GOS-8 SDL, but never
 * populated by this implementation — see the GOS-22 plan's "Decisiones y
 * discrepancias" #2. Hard failures are instead thrown as `DomainException`
 * and surfaced via `extensions.code` (see `../filters/domain-exception.filter.ts`).
 *
 * Lives under `common/` (not `users/` or `auth/`) because both modules'
 * payload types (`VerifyEmailCodePayload` in `users/`, `LoginPayload` in
 * `auth/`) declare an `errors` field of this type — it is not owned by
 * either domain module.
 */
@ObjectType()
export class DomainError {
  @Field()
  code!: string;

  @Field()
  message!: string;
}
