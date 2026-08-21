import type {
  AdminQuoteDetailRow,
  AdminQuoteRow,
} from '../../../quotes/quotes.repository';
import { AdminServiceRequestCustomerModel } from '../../service-requests/models/admin-service-request-customer.model';
import { AdminQuoteDetailModel } from './admin-quote-detail.model';
import { AdminQuoteEngagementModel } from './admin-quote-engagement.model';
import { AdminQuoteProfessionalModel } from './admin-quote-professional.model';
import { AdminQuoteServiceRequestModel } from './admin-quote-service-request.model';
import { AdminQuoteModel } from './admin-quote.model';

function toCustomerModel(
  customerProfile: AdminQuoteRow['serviceRequest']['customerProfile'],
): AdminServiceRequestCustomerModel {
  const model = new AdminServiceRequestCustomerModel();
  model.id = customerProfile.id;
  model.userId = customerProfile.user.id;
  model.displayName = customerProfile.displayName;
  model.email = customerProfile.user.email;
  model.firstName = customerProfile.user.firstName;
  model.lastName = customerProfile.user.lastName;
  return model;
}

function toServiceRequestModel(
  serviceRequest: AdminQuoteRow['serviceRequest'],
): AdminQuoteServiceRequestModel {
  const model = new AdminQuoteServiceRequestModel();
  model.id = serviceRequest.id;
  model.description = serviceRequest.description;
  model.status = serviceRequest.status;
  model.category = serviceRequest.category;
  model.customerProfile = toCustomerModel(serviceRequest.customerProfile);
  return model;
}

function toProfessionalModel(
  professionalProfile: AdminQuoteRow['professionalProfile'],
): AdminQuoteProfessionalModel {
  const model = new AdminQuoteProfessionalModel();
  model.id = professionalProfile.id;
  model.userId = professionalProfile.user.id;
  model.displayName = professionalProfile.displayName;
  model.email = professionalProfile.user.email;
  model.firstName = professionalProfile.user.firstName;
  model.lastName = professionalProfile.user.lastName;
  return model;
}

function toEngagementModel(
  engagement: AdminQuoteDetailRow['engagement'],
): AdminQuoteEngagementModel | null {
  if (!engagement) {
    return null;
  }
  const model = new AdminQuoteEngagementModel();
  model.id = engagement.id;
  model.status = engagement.status;
  model.createdAt = engagement.createdAt;
  return model;
}

/**
 * Maps a `QuotesRepository.ADMIN_QUOTE_SELECT`-shaped row to the
 * GraphQL-facing `AdminQuoteModel` (grid row).
 */
export function toAdminQuoteModel(row: AdminQuoteRow): AdminQuoteModel {
  const model = new AdminQuoteModel();
  model.id = row.id;
  model.price = row.price;
  model.message = row.message;
  model.status = row.status;
  model.serviceRequest = toServiceRequestModel(row.serviceRequest);
  model.professional = toProfessionalModel(row.professionalProfile);
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}

/**
 * Maps a `QuotesRepository.ADMIN_QUOTE_DETAIL_SELECT`-shaped row to the
 * GraphQL-facing `AdminQuoteDetailModel`.
 */
export function toAdminQuoteDetailModel(
  row: AdminQuoteDetailRow,
): AdminQuoteDetailModel {
  const model = new AdminQuoteDetailModel();
  model.id = row.id;
  model.price = row.price;
  model.message = row.message;
  model.status = row.status;
  model.serviceRequest = toServiceRequestModel(row.serviceRequest);
  model.professional = toProfessionalModel(row.professionalProfile);
  model.engagement = toEngagementModel(row.engagement);
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  return model;
}
