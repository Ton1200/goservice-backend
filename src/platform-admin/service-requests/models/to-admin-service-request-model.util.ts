import type {
  AdminServiceRequestDetailRow,
  AdminServiceRequestRow,
} from '../../../service-requests/service-requests.repository';
import { AdminServiceRequestCustomerModel } from './admin-service-request-customer.model';
import { AdminServiceRequestDetailModel } from './admin-service-request-detail.model';
import { AdminServiceRequestModel } from './admin-service-request.model';
import { AdminServiceRequestQuoteModel } from './admin-service-request-quote.model';
import { AdminServiceRequestQuoteProfessionalModel } from './admin-service-request-quote-professional.model';

function toCustomerModel(
  customerProfile: AdminServiceRequestRow['customerProfile'],
): AdminServiceRequestCustomerModel {
  const model = new AdminServiceRequestCustomerModel();
  model.id = customerProfile.id;
  model.userId = customerProfile.user.id;
  model.email = customerProfile.user.email;
  model.firstName = customerProfile.firstName;
  model.lastName = customerProfile.lastName;
  return model;
}

/**
 * Maps a `ServiceRequestsRepository.ADMIN_SERVICE_REQUEST_SELECT`-shaped
 * row to the GraphQL-facing `AdminServiceRequestModel` (grid row).
 */
export function toAdminServiceRequestModel(
  row: AdminServiceRequestRow,
): AdminServiceRequestModel {
  const model = new AdminServiceRequestModel();
  model.id = row.id;
  model.customer = toCustomerModel(row.customerProfile);
  model.category = row.category;
  model.description = row.description;
  model.urgency = row.urgency;
  model.indicativeBudgetMin = row.indicativeBudgetMin;
  model.indicativeBudgetMax = row.indicativeBudgetMax;
  model.status = row.status;
  model.cancelledAt = row.cancelledAt;
  model.attachmentsCount = row._count.attachments;
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}

function toQuoteProfessionalModel(
  professionalProfile: AdminServiceRequestDetailRow['quotes'][number]['professionalProfile'],
): AdminServiceRequestQuoteProfessionalModel {
  const model = new AdminServiceRequestQuoteProfessionalModel();
  model.firstName = professionalProfile.firstName;
  model.lastName = professionalProfile.lastName;
  model.displayName = professionalProfile.displayName;
  model.email = professionalProfile.user.email;
  return model;
}

function toQuoteModel(
  quote: AdminServiceRequestDetailRow['quotes'][number],
): AdminServiceRequestQuoteModel {
  const model = new AdminServiceRequestQuoteModel();
  model.id = quote.id;
  model.price = quote.price;
  model.negotiatedPrice = quote.negotiatedPrice;
  model.finalPrice = quote.negotiatedPrice ?? quote.price;
  model.status = quote.status;
  model.negotiationMessageCount = quote._count.negotiationMessages;
  model.professional = toQuoteProfessionalModel(quote.professionalProfile);
  model.createdAt = quote.createdAt;
  return model;
}

/**
 * Maps a `ServiceRequestsRepository.ADMIN_SERVICE_REQUEST_DETAIL_SELECT`-shaped
 * row to the GraphQL-facing `AdminServiceRequestDetailModel`.
 */
export function toAdminServiceRequestDetailModel(
  row: AdminServiceRequestDetailRow,
): AdminServiceRequestDetailModel {
  const model = new AdminServiceRequestDetailModel();
  model.id = row.id;
  model.customer = toCustomerModel(row.customerProfile);
  model.category = row.category;
  model.description = row.description;
  model.urgency = row.urgency;
  model.indicativeBudgetMin = row.indicativeBudgetMin;
  model.indicativeBudgetMax = row.indicativeBudgetMax;
  model.status = row.status;
  model.cancelledAt = row.cancelledAt;
  model.attachments = row.attachments;
  model.quotes = row.quotes.map(toQuoteModel);
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}
