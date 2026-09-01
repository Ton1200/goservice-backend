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
import { AdminServiceRequestQuoteModel } from './admin-service-request-quote.model';

/**
 * Admin-facing GraphQL type for `serviceRequestDetail` (`/admin/graphql`
 * only), gated by the SAME `Permission.SERVICE_REQUESTS_READ` as
 * `serviceRequests` — no new permission for this read-only detail view,
 * same convention `userAccountDetail` already established. Deliberately a
 * SEPARATE type from `AdminServiceRequestModel` (the grid-row shape),
 * carrying the full `attachments` list instead of just a count.
 *
 * `quotes` (GOS-53 Quote Negotiation admin follow-up) - every Quote ever
 * submitted against this ServiceRequest, newest first, powering the
 * redesigned detail popup's "Cotizaciones" tab. Deliberately gated by the
 * SAME `SERVICE_REQUESTS_READ` as the rest of this type, NOT also
 * `Permission.QUOTES_READ` - an admin who can see a ServiceRequest's detail
 * can already see who quoted it and for how much via the separate Quotes
 * grid (`Permission.QUOTES_READ`) today; today every role that holds
 * `SERVICE_REQUESTS_READ` also holds `QUOTES_READ` (see this task's own
 * "Context you need" notes), so this is a judgment call worth a human
 * sanity-check if that ever structurally diverges. The embedded rows
 * themselves stay lean (`AdminServiceRequestQuoteModel`, no `message`/
 * `serviceRequest` back-reference) - reading the full negotiation thread
 * content for a given Quote still requires the separate, dedicated
 * `Permission.QUOTE_NEGOTIATION_READ`-gated `adminQuoteNegotiationThread`
 * query, unaffected by this field.
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

  @Field(() => [AdminServiceRequestQuoteModel])
  quotes!: AdminServiceRequestQuoteModel[];

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
