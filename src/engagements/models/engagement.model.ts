import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { EngagementStatus } from './engagement-status.enum';

/**
 * A confirmed, contracted job — created exactly once, atomically, the
 * moment a Quote is accepted (see `AcceptQuoteService`). Deliberately
 * exposes only raw `customerProfileId`/`professionalProfileId` — NOT the
 * full `CustomerProfile`/`ProfessionalProfile` objects — same
 * "no `@ResolveField` reaching into another profile's data" discipline
 * `ServiceRequestModel`'s own header comment already documents. Neither
 * profile currently carries a precise-location field at all (see
 * `goservice-docs/decisions/DEC-005-location-and-proximity.md`) — nothing
 * to leak today, and this type's own shape makes it structurally
 * impossible to add one here without a deliberate, visible change.
 */
@ObjectType('Engagement')
export class EngagementModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  serviceRequestId!: string;

  @Field(() => ID)
  quoteId!: string;

  @Field(() => ID)
  customerProfileId!: string;

  @Field(() => ID)
  professionalProfileId!: string;

  @Field(() => EngagementStatus)
  status!: EngagementStatus;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
