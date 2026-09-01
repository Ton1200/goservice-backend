import { Field, GraphQLISODateTime, InputType } from '@nestjs/graphql';
import { IsDate } from 'class-validator';

/**
 * Structurally closed input — no `engagementId`/`proposedByRole`/
 * `customerProfileId`/`professionalProfileId` field. The proposing party's
 * identity is ALWAYS resolved server-side from `@CurrentUser()` +
 * `AppointmentAccessService.resolveParty` (see `ProposeAppointmentService`)
 * — same pattern `PostQuoteNegotiationMessageInput` already establishes for
 * `authorRole`/profile ids. `engagementId` is a separate resolver argument,
 * same shape as `sendEngagementMessage(engagementId, input)`.
 *
 * First `@InputType()` in this codebase with a `GraphQLISODateTime` field
 * (every prior `GraphQLISODateTime` usage is on an `@ObjectType()` OUTPUT
 * field only). `@nestjs/graphql`'s `GraphQLISODateTime` scalar parses the
 * incoming ISO string into a real `Date` at the GraphQL layer BEFORE the
 * global `ValidationPipe({ transform: true })` (see `main.ts`/
 * `test/support/test-app.ts`) runs `class-validator` against this DTO — so
 * `@IsDate()` (which checks `value instanceof Date`) sees an actual `Date`
 * instance, not a string. Confirmed empirically via
 * `test/appointments.e2e-spec.ts` (a malformed/non-ISO literal is rejected
 * by the GraphQL scalar itself, before this validator ever runs; a
 * well-formed ISO string round-trips into a real `Date` and passes
 * `@IsDate()`), not merely assumed.
 *
 * `endsAt > startsAt` is service-level validation
 * (`APPOINTMENT_INVALID_TIME_RANGE`, see `ProposeAppointmentService`), not a
 * cross-field `class-validator` decorator here — same "business validation
 * belongs in the service layer" posture as
 * `PostQuoteNegotiationMessageInput`'s own header comment documents for
 * `proposedPrice`.
 */
@InputType()
export class ProposeAppointmentInput {
  @Field(() => GraphQLISODateTime)
  @IsDate()
  startsAt!: Date;

  @Field(() => GraphQLISODateTime)
  @IsDate()
  endsAt!: Date;
}
