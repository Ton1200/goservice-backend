import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Category } from '../../../profiles/models/category.model';
import { ServiceRequestStatus } from '../../../service-requests/models/service-request-status.enum';
import { AdminServiceRequestCustomerModel } from '../../service-requests/models/admin-service-request-customer.model';

/**
 * Lightweight `ServiceRequest` summary attached to a `Quote` row/detail —
 * just enough for an admin to identify the parent request (and, via
 * `customerProfile`, the Customer who owns it — reused directly from
 * `platform-admin/service-requests/`, never duplicated) without pulling in
 * that ServiceRequest's full detail shape (`attachments`, budget range,
 * etc. — irrelevant on the Quotes grid). Deliberately its own, SEPARATE
 * admin-only type from `AdminServiceRequestModel`/`AdminServiceRequestDetailModel`
 * (the Service Requests grid's own row/detail shapes) — same
 * "grid-appropriate summary, not the full type" reasoning `AdminServiceRequestModel`
 * itself already establishes relative to `AdminServiceRequestDetailModel`.
 */
@ObjectType('AdminQuoteServiceRequest')
export class AdminQuoteServiceRequestModel {
  @Field(() => ID)
  id!: string;

  @Field()
  description!: string;

  @Field(() => ServiceRequestStatus)
  status!: ServiceRequestStatus;

  @Field(() => Category)
  category!: Category;

  @Field(() => AdminServiceRequestCustomerModel)
  customerProfile!: AdminServiceRequestCustomerModel;
}
