import { Injectable, Logger } from '@nestjs/common';
import { ServiceRequestStatus } from '@prisma/client';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../errors/customer-profile-required.error';
import { serviceRequestAlreadyCancelled } from '../errors/service-request-already-cancelled.error';
import { serviceRequestHasEngagement } from '../errors/service-request-has-engagement.error';
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
 *
 * GOS-41 — a `ServiceRequest` that is `ENGAGED` (a Quote has been accepted)
 * can never be cancelled — see `serviceRequestHasEngagement()`'s own
 * comment. The pre-read below exists purely for a good, specific error
 * message in the common (non-race) case — the ACTUAL safety mechanism
 * against a concurrent `acceptQuote` is the guarded CAS in
 * `ServiceRequestsRepository.cancel()`: if the pre-read still saw `OPEN`
 * but a concurrent `acceptQuote` won the race first, the CAS reports
 * `count === 0` and this service re-reads and throws the correct error
 * instead of silently reporting success.
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

    this.assertCancellable(existing.status);

    const { count } =
      await this.serviceRequestsRepository.cancel(serviceRequestId);
    if (count !== 1) {
      // Lost a race against a concurrent acceptQuote/cancelServiceRequest
      // between the pre-read above and the CAS write — re-read to report
      // the correct current-state error instead of a generic failure.
      const current =
        await this.serviceRequestsRepository.findById(serviceRequestId);
      this.assertCancellable(current?.status ?? existing.status);
      // assertCancellable above always throws for a non-OPEN status, so
      // this line is unreachable in practice — kept only as a defensive
      // fallback in case current is somehow still OPEN (should never
      // happen: this branch only runs when the CAS itself reported it did
      // NOT transition anything away from OPEN).
      throw serviceRequestNotFound();
    }

    const cancelled =
      await this.serviceRequestsRepository.findById(serviceRequestId);

    this.logger.log({
      event: 'service_request_cancelled',
      outcome: 'success',
      serviceRequestId,
    });

    return cancelled!;
  }

  private assertCancellable(status: ServiceRequestStatus): void {
    if (status === ServiceRequestStatus.CANCELLED) {
      throw serviceRequestAlreadyCancelled();
    }
    if (status === ServiceRequestStatus.ENGAGED) {
      throw serviceRequestHasEngagement();
    }
  }
}
