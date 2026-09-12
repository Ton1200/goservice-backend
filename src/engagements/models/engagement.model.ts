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

  /**
   * GOS-111 — set the moment the Professional calls `startEngagementWork`
   * (ACCEPTED → IN_PROGRESS); `null` before then.
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  startedAt?: Date | null;

  /**
   * GOS-111 — set the moment the Professional calls
   * `markEngagementWorkFinished` (IN_PROGRESS → PENDING_CUSTOMER_CONFIRMATION);
   * `null` before then.
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  finishedAt?: Date | null;

  /**
   * GOS-114 — set the moment the Customer calls
   * `cancelEngagementByCustomer` (ACCEPTED|IN_PROGRESS → CANCELLED); `null`
   * before then.
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  cancelledAt?: Date | null;

  /**
   * GOS-114 — the Customer-supplied reason passed to
   * `cancelEngagementByCustomer`; `null` until then.
   */
  @Field(() => String, { nullable: true })
  cancelReason?: string | null;

  /**
   * GOS-121 — set the moment `confirmEngagementCompletion` succeeds
   * (PENDING_CUSTOMER_CONFIRMATION → COMPLETED); `null` before then. Added
   * retroactively for GOS-121's 14-day double-blind review window — GOS-113
   * itself shipped without this column (see `Engagement.completedAt`'s own
   * comment in `prisma/schema.prisma`).
   */
  @Field(() => GraphQLISODateTime, { nullable: true })
  completedAt?: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
