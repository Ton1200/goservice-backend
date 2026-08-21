import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../../service-requests/errors/customer-profile-required.error';
import { serviceRequestNotFound } from '../../service-requests/errors/service-request-not-found.error';
import { ServiceRequestsRepository } from '../../service-requests/service-requests.repository';
import { QuoteModel } from '../models/quote.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Query.quotesForServiceRequest` — the Customer's own view of
 * every Quote submitted against one of their own `ServiceRequest`s.
 * Ownership is checked the same way `CancelServiceRequestService` does
 * (same reused `serviceRequestNotFound()` anti-enumeration code).
 */
@Injectable()
export class ListQuotesForServiceRequestService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async listQuotesForServiceRequest(
    userId: string,
    serviceRequestId: string,
  ): Promise<QuoteModel[]> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    const serviceRequest =
      await this.serviceRequestsRepository.findById(serviceRequestId);
    if (
      !serviceRequest ||
      serviceRequest.customerProfileId !== customerProfile.id
    ) {
      throw serviceRequestNotFound();
    }

    return this.quotesRepository.findManyByServiceRequestId(serviceRequestId);
  }
}
