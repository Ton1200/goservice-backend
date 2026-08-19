import { Injectable, Logger } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../errors/customer-profile-required.error';
import { serviceRequestAlreadyCancelled } from '../errors/service-request-already-cancelled.error';
import { serviceRequestNotFound } from '../errors/service-request-not-found.error';
import { ServiceRequestModel } from '../models/service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Mutation.cancelServiceRequest`. Ownership is ALWAYS
 * resolved server-side from `@CurrentUser()` — this mutation takes no
 * `customerProfileId` input, only the target `serviceRequestId`; a Customer
 * can never cancel another Customer's `ServiceRequest` because there is no
 * way to even attempt it other than by id, and id ownership is checked
 * below before anything is mutated.
 */
@Injectable()
export class CancelServiceRequestService {
  private readonly logger = new Logger(CancelServiceRequestService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async cancelServiceRequest(
    userId: string,
    serviceRequestId: string,
  ): Promise<ServiceRequestModel> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw customerProfileRequired();
    }

    const existing =
      await this.serviceRequestsRepository.findById(serviceRequestId);
    if (!existing || existing.customerProfileId !== customerProfile.id) {
      // Same code for "doesn't exist" and "exists but isn't yours" —
      // deliberate anti-enumeration choice, see serviceRequestNotFound()'s
      // own comment.
      throw serviceRequestNotFound();
    }

    if (existing.status === ServiceRequestStatus.CANCELLED) {
      throw serviceRequestAlreadyCancelled();
    }

    const cancelled =
      await this.serviceRequestsRepository.cancel(serviceRequestId);

    this.logger.log({
      event: 'service_request_cancelled',
      outcome: 'success',
      serviceRequestId: cancelled.id,
    });

    return cancelled;
  }
}
