import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import { Category } from '../../../profiles/models/category.model';
import { ServiceRequestAttachmentModel } from '../../../service-requests/models/service-request-attachment.model';
import { ServiceRequestStatus } from '../../../service-requests/models/service-request-status.enum';
import { ServiceRequestUrgency } from '../../../service-requests/models/service-request-urgency.enum';
import { AdminServiceRequestCustomerModel } from './admin-service-request-customer.model';

/**
 * Admin-facing GraphQL type for `serviceRequestDetail` (`/admin/graphql`
 * only), gated by the SAME `Permission.SERVICE_REQUESTS_READ` as
 * `serviceRequests` — no new permission for this read-only detail view,
 * same convention `userAccountDetail` already established. Deliberately a
 * SEPARATE type from `AdminServiceRequestModel` (the grid-row shape),
 * carrying the full `attachments` list instead of just a count.
 */
@ObjectType('AdminServiceRequestDetail')
export class AdminServiceRequestDetailModel {
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

  @Field(() => [ServiceRequestAttachmentModel])
  attachments!: ServiceRequestAttachmentModel[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
