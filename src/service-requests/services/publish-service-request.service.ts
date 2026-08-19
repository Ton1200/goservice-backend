import { Injectable, Logger } from '@nestjs/common';
import { ServiceRequestAttachmentUploadRef } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../errors/customer-profile-required.error';
import { invalidAttachmentUploadRef } from '../errors/invalid-attachment-upload-ref.error';
import { invalidServiceRequestBudgetRange } from '../errors/invalid-service-request-budget-range.error';
import { PublishServiceRequestInput } from '../models/publish-service-request-input.model';
import { ServiceRequestModel } from '../models/service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Mutation.publishServiceRequest`. The owning `CustomerProfile`
 * is ALWAYS resolved server-side from `@CurrentUser()` — this service never
 * receives or trusts a `customerProfileId` from the caller (see
 * `PublishServiceRequestInput`, which has no such field).
 */
@Injectable()
export class PublishServiceRequestService {
  private readonly logger = new Logger(PublishServiceRequestService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async publishServiceRequest(
    userId: string,
    input: PublishServiceRequestInput,
  ): Promise<ServiceRequestModel> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      // Should never happen once AccountApprovedGuard already confirmed
      // APPROVED — see customerProfileRequired()'s own comment.
      throw customerProfileRequired();
    }

    const existingCategoryIds =
      await this.profilesRepository.findExistingCategoryIds([input.category]);
    if (existingCategoryIds.length === 0) {
      // Same code `profiles/upsert-professional-profile.service.ts` already
      // uses for a nonexistent category — reused deliberately, not
      // duplicated under a new name.
      throw new DomainException(
        'CATEGORY_NOT_FOUND',
        `The following category IDs do not exist: ${input.category}.`,
      );
    }

    if (
      input.indicativeBudgetMin !== undefined &&
      input.indicativeBudgetMax !== undefined &&
      input.indicativeBudgetMin > input.indicativeBudgetMax
    ) {
      throw invalidServiceRequestBudgetRange();
    }

    const attachmentRefs = await this.resolveAttachmentRefs(
      userId,
      input.attachmentUploadRefs ?? [],
    );

    const serviceRequest = await this.serviceRequestsRepository.publish({
      customerProfileId: customerProfile.id,
      categoryId: input.category,
      description: input.description,
      urgency: input.urgency,
      indicativeBudgetMin: input.indicativeBudgetMin ?? null,
      indicativeBudgetMax: input.indicativeBudgetMax ?? null,
      attachmentRefs,
    });

    this.logger.log({
      event: 'service_request_published',
      outcome: 'success',
      serviceRequestId: serviceRequest.id,
      categoryId: serviceRequest.categoryId,
      attachmentCount: serviceRequest.attachments.length,
    });

    return serviceRequest;
  }

  /**
   * Validates every submitted ref (ownership, PENDING status, not expired
   * — see `ServiceRequestsRepository.findUsablePendingUploadRefs`) and
   * returns the resolved rows in the SAME order the client submitted them,
   * so `ServiceRequestsRepository.publish` can derive stable
   * `ServiceRequestAttachment.order` values from that order. Any ref that
   * doesn't come back as "usable" — for any reason (doesn't exist, belongs
   * to someone else, already consumed, expired) — rejects the WHOLE
   * mutation with one generic, anti-enumeration error; no `ServiceRequest`
   * is created with a partial attachment set.
   */
  private async resolveAttachmentRefs(
    userId: string,
    refIds: string[],
  ): Promise<ServiceRequestAttachmentUploadRef[]> {
    if (refIds.length === 0) {
      return [];
    }

    const usableRefs =
      await this.serviceRequestsRepository.findUsablePendingUploadRefs(
        userId,
        refIds,
      );
    if (usableRefs.length !== refIds.length) {
      throw invalidAttachmentUploadRef();
    }

    const usableRefsById = new Map(
      usableRefs.map((ref) => [ref.id, ref] as const),
    );
    return refIds.map((refId) => usableRefsById.get(refId)!);
  }
}
