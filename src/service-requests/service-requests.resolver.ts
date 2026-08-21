import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { DocumentUploadUrlModel } from './models/document-upload-url.model';
import { PublishServiceRequestInput } from './models/publish-service-request-input.model';
import { RequestServiceRequestAttachmentUploadUrlInput } from './models/request-service-request-attachment-upload-url-input.model';
import { ServiceRequestModel } from './models/service-request.model';
import { CancelServiceRequestService } from './services/cancel-service-request.service';
import { ListCompatibleServiceRequestsService } from './services/list-compatible-service-requests.service';
import { ListMyServiceRequestsService } from './services/list-my-service-requests.service';
import { PublishServiceRequestService } from './services/publish-service-request.service';
import { RequestServiceRequestAttachmentUploadUrlService } from './services/request-service-request-attachment-upload-url.service';

/**
 * Thin delivery adapter — no business logic here, same pattern as
 * `ProfilesResolver`/`IdentityVerificationResolver`. Every query/mutation
 * that acts on/reads a Customer's or Professional's own `ServiceRequest`
 * data requires `SessionGuard` + `AccountApprovedGuard`, in that exact
 * order (`AccountApprovedGuard` reads `req.userId`, set only by
 * `SessionGuard` — see that guard's own header comment). The one exception
 * is `requestServiceRequestAttachmentUploadUrl`, which only requires
 * `SessionGuard` — see that mutation's own doc string for why.
 *
 * No operation here accepts `customerProfileId`/`professionalProfileId`/
 * `userId` as an argument — ownership is always derived from
 * `@CurrentUser()`.
 */
@Resolver()
export class ServiceRequestsResolver {
  constructor(
    private readonly publishServiceRequestService: PublishServiceRequestService,
    private readonly cancelServiceRequestService: CancelServiceRequestService,
    private readonly listMyServiceRequestsService: ListMyServiceRequestsService,
    private readonly listCompatibleServiceRequestsService: ListCompatibleServiceRequestsService,
    private readonly requestServiceRequestAttachmentUploadUrlService: RequestServiceRequestAttachmentUploadUrlService,
  ) {}

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [ServiceRequestModel], {
    description:
      "The authenticated Customer's own ServiceRequests, most recent first. Always derived from the session — takes no arguments.",
  })
  myPublishedServiceRequests(
    @CurrentUser() userId: string,
  ): Promise<ServiceRequestModel[]> {
    return this.listMyServiceRequestsService.listMyServiceRequests(userId);
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Query(() => [ServiceRequestModel], {
    description:
      "OPEN ServiceRequests whose category matches one of the authenticated Professional's own specializations. Read-only — this query never exposes another Professional's data and never accepts a professionalProfileId argument.",
  })
  compatibleServiceRequests(
    @CurrentUser() userId: string,
  ): Promise<ServiceRequestModel[]> {
    return this.listCompatibleServiceRequestsService.listCompatibleServiceRequests(
      userId,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => ServiceRequestModel, {
    description:
      "Publishes a new ServiceRequest as OPEN, owned by the authenticated Customer's own CustomerProfile (never a client-supplied one).",
  })
  publishServiceRequest(
    @CurrentUser() userId: string,
    @Args('input') input: PublishServiceRequestInput,
  ): Promise<ServiceRequestModel> {
    return this.publishServiceRequestService.publishServiceRequest(
      userId,
      input,
    );
  }

  @UseGuards(SessionGuard, AccountApprovedGuard)
  @Mutation(() => ServiceRequestModel, {
    description:
      "Cancels one of the authenticated Customer's own OPEN ServiceRequests. Rejects if it does not exist, does not belong to the caller, or is already CANCELLED.",
  })
  cancelServiceRequest(
    @CurrentUser() userId: string,
    @Args('serviceRequestId', { type: () => ID }) serviceRequestId: string,
  ): Promise<ServiceRequestModel> {
    return this.cancelServiceRequestService.cancelServiceRequest(
      userId,
      serviceRequestId,
    );
  }

  @UseGuards(SessionGuard)
  @Mutation(() => DocumentUploadUrlModel, {
    description:
      'Reserves one attachment upload slot for the authenticated user. Only requires an active session (not account approval) — this prepares a draft attachment; publishServiceRequest (which IS approval-gated) is what actually consumes the resulting ref.',
  })
  requestServiceRequestAttachmentUploadUrl(
    @CurrentUser() userId: string,
    @Args('input') input: RequestServiceRequestAttachmentUploadUrlInput,
  ): Promise<DocumentUploadUrlModel> {
    return this.requestServiceRequestAttachmentUploadUrlService.requestUploadUrl(
      userId,
      input,
    );
  }
}
