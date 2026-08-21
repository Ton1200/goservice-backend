import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Category } from '../../../profiles/models/category.model';
import { ServiceRequestStatus } from '../../../service-requests/models/service-request-status.enum';
import { ServiceRequestUrgency } from '../../../service-requests/models/service-request-urgency.enum';
import { AdminServiceRequestCustomerModel } from './admin-service-request-customer.model';

/**
 * Admin-facing GraphQL type for `serviceRequests` (`/admin/graphql` only —
 * never the consumer schema), gated by `Permission.SERVICE_REQUESTS_READ`.
 * Grid-row shape — deliberately lighter than `AdminServiceRequestDetailModel`
 * (no `attachments` list, only `attachmentsCount`), same
 * grid-vs-detail split `UserAccountModel`/`UserAccountDetailModel` already
 * establish.
 *
 * Reuses the consumer schema's `Category`/`ServiceRequestStatus`/
 * `ServiceRequestUrgency` types directly (same "orphaned type made
 * reachable from an admin field" pattern `userAccountDetail` already
 * established for `CustomerProfile`/`ProfessionalProfile` — see
 * `PlatformAdminModule`'s own header comment) — never a duplicate admin-only
 * copy of either.
 */
@ObjectType('AdminServiceRequest')
export class AdminServiceRequestModel {
  @Field(() => ID)
  id!: string;

  @Field(() => AdminServiceRequestCustomerModel)
  customer!: AdminServiceRequestCustomerModel;

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

  @Field(() => GraphQLISODateTime, { nullable: true })
  cancelledAt!: Date | null;

  @Field(() => Int)
  attachmentsCount!: number;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
