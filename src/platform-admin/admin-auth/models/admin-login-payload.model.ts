import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { DomainError } from '../../../common/graphql/domain-error.model';

/**
 * `errors` is kept for SDL fidelity but never populated — `adminUserId: ID!`
 * is non-null and cannot coexist with a partial failure payload, so hard
 * `adminLogin` failures are thrown as `DomainException` instead (always the
 * shared `adminAuthenticationFailed()` result). Same pattern as the
 * consumer schema's `LoginPayload`.
 *
 * `sessionExpiresAt` uses `GraphQLISODateTime` (real time-of-day
 * precision), NOT the consumer schema's calendar-only custom `Date` scalar
 * (`LoginPayload.sessionExpiresAt`) — a deliberate deviation from the
 * ticket's literal contract, called out in the platform-admin plan: a
 * short-TTL (minutes-scale) admin session's expiry needs real
 * time-of-day precision, which the `Date` scalar's truncation-to-calendar-day
 * would make useless.
 */
@ObjectType()
export class AdminLoginPayload {
  @Field(() => ID)
  adminUserId!: string;

  @Field()
  sessionToken!: string;

  @Field(() => GraphQLISODateTime)
  sessionExpiresAt!: Date;

  /**
   * Flat, minimal addition (not a full `AdminUser` GraphQL object type —
   * that's Slice 3's job when admin-user management is actually built) so
   * the platform-admin panel's header can show which admin is connected
   * without an extra round-trip: both fields already sit on the
   * `AdminUser` record `AdminLoginService` loads during login.
   */
  @Field()
  email!: string;

  @Field()
  displayName!: string;

  @Field(() => [DomainError], { nullable: true })
  errors?: DomainError[];
}
