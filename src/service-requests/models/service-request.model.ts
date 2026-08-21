import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Category } from '../../profiles/models/category.model';
import { ServiceRequestAttachmentModel } from './service-request-attachment.model';
import { ServiceRequestStatus } from './service-request-status.enum';
import { ServiceRequestUrgency } from './service-request-urgency.enum';

/**
 * A need posted by a Customer — see
 * goservice-docs/architecture/ubiquitous-language.md ("never call this a
 * 'listing' or 'job posting'").
 *
 * `customerProfileId` IS exposed here (unlike `CustomerProfile`'s own
 * `@ObjectType`, which never exposes `userId`) because the GOS-38 ticket's
 * own contract specifies it — see the GOS-38 plan's GraphQL-contract
 * section, deviation #4, for the privacy tradeoff this was weighed against
 * before keeping it.
 *
 * Deliberately does NOT resolve or expose anything about the owning
 * `CustomerProfile` beyond that raw id — no `@ResolveField` anywhere in
 * this module reaches into `CustomerProfile`'s address/city/province/
 * country. This is the actual privacy control for `compatibleServiceRequests`
 * (an absence, not a filter) — see the GOS-38 plan's "Privacidad de
 * ubicación" section.
 */
@ObjectType('ServiceRequest')
export class ServiceRequestModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  customerProfileId!: string;

  @Field(() => Category)
  category!: Category;

  @Field()
  description!: string;

  @Field(() => ServiceRequestUrgency)
  urgency!: ServiceRequestUrgency;

  @Field(() => Int, { nullable: true })
  indicativeBudgetMin!: number | null;

  @Field(() => Int, { nullable: true })
  indicativeBudgetMax!: number | null;

  @Field(() => ServiceRequestStatus)
  status!: ServiceRequestStatus;

  @Field(() => [ServiceRequestAttachmentModel])
  attachments!: ServiceRequestAttachmentModel[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
