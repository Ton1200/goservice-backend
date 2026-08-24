import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { AppointmentParty } from './appointment-party.enum';
import { AppointmentStatus } from './appointment-status.enum';

/**
 * A proposed/confirmed visit slot on an already-`ACCEPTED` Engagement.
 * `startsAt`/`endsAt`/`cancelledAt`/`confirmedAt`/`createdAt`/`updatedAt`
 * are all `GraphQLISODateTime` (carries a time-of-day) — NEVER the
 * calendar-only `Date` scalar (`src/common/graphql/date.scalar.ts`), which
 * has no time component and would be meaningless for a scheduling slot.
 *
 * Deliberately does NOT expose `proposedByCustomerProfileId`/
 * `proposedByProfessionalProfileId` directly — same reasoning as
 * `QuotePriceProposalModel`'s own header comment: `proposedByRole` already
 * tells the caller which SIDE proposed it, and both parties on an
 * Engagement already know each other's identity via
 * `Engagement.customerProfile`/`Engagement.professionalProfile`, so no
 * extra field is needed here for the consumer-facing capability.
 */
@ObjectType('Appointment')
export class AppointmentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  engagementId!: string;

  @Field(() => ID)
  professionalProfileId!: string;

  @Field(() => GraphQLISODateTime)
  startsAt!: Date;

  @Field(() => GraphQLISODateTime)
  endsAt!: Date;

  @Field(() => AppointmentStatus)
  status!: AppointmentStatus;

  @Field(() => AppointmentParty)
  proposedByRole!: AppointmentParty;

  @Field(() => String, { nullable: true })
  cancelReason?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  cancelledAt?: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  confirmedAt?: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
